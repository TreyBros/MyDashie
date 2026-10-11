import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ChatMessage, DashboardManifest, RefreshLogEntry, Schedule } from "@shared/types";
import type { Paths } from "../store/paths";
import type { Recipe } from "../agent/provenance";

export interface DataSnapshot {
  fetchedAt: string;
  datasets: Record<string, unknown>;
}

const HISTORY_KEEP = 20;

function now() {
  return new Date().toISOString();
}

export class DashboardRepo {
  private listeners = new Set<() => void>();
  constructor(private paths: Paths) {}

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  dir(id: string) {
    return this.paths.dashboard(id);
  }
  private manifestPath(id: string) {
    return join(this.dir(id), "dashboard.json");
  }

  list(): DashboardManifest[] {
    if (!existsSync(this.paths.dashboards)) return [];
    return readdirSync(this.paths.dashboards)
      .filter((d) => existsSync(this.manifestPath(d)))
      .map((d) => this.get(d)!)
      .sort((a, b) => (b.createdAt ?? b.updatedAt).localeCompare(a.createdAt ?? a.updatedAt));
  }

  get(id: string): DashboardManifest | undefined {
    try {
      return JSON.parse(readFileSync(this.manifestPath(id), "utf8"));
    } catch {
      return undefined;
    }
  }

  create(input: { name: string; prompt: string; emoji?: string }): DashboardManifest {
    const id = randomBytes(6).toString("hex");
    const m: DashboardManifest = {
      id,
      name: input.name,
      emoji: "",
      icon: "general",
      description: "",
      prompt: input.prompt,
      createdAt: now(),
      updatedAt: now(),
      status: "draft",
      schedule: { kind: "off" },
      datasets: [],
      hasHtml: false,
    };
    mkdirSync(join(this.dir(id), "history"), { recursive: true });
    mkdirSync(join(this.dir(id), "work"), { recursive: true });
    this.write(m);
    return m;
  }

  private write(m: DashboardManifest) {
    writeFileSync(this.manifestPath(m.id), JSON.stringify(m, null, 2));
    this.emit();
  }

  update(id: string, patch: Partial<DashboardManifest>): DashboardManifest {
    const m = this.get(id);
    if (!m) throw new Error(`Dashboard ${id} not found`);
    const next = { ...m, ...patch, id, updatedAt: now() };
    this.write(next);
    return next;
  }

  setSchedule(id: string, schedule: Schedule) {
    return this.update(id, { schedule });
  }

  delete(id: string) {
    rmSync(this.dir(id), { recursive: true, force: true });
    this.emit();
  }

  // ---- html ----
  htmlPath(id: string) {
    return join(this.dir(id), "index.html");
  }
  getHtml(id: string): string | undefined {
    try {
      return readFileSync(this.htmlPath(id), "utf8");
    } catch {
      return undefined;
    }
  }
  // ---- versions (snapshot before every AI run, so any change can be undone) ----
  private versionsDir(id: string) {
    const d = join(this.dir(id), "versions");
    mkdirSync(d, { recursive: true });
    return d;
  }
  saveVersion(id: string, label: string) {
    const html = this.getHtml(id);
    if (!html) return undefined;
    const vid = new Date().toISOString().replace(/[:.]/g, "-");
    const snap = { id: vid, at: new Date().toISOString(), label: label.slice(0, 140), html, data: this.getData(id) ?? null, recipe: this.getRecipe(id) ?? null, datasets: this.get(id)?.datasets ?? [] };
    writeFileSync(join(this.versionsDir(id), `${vid}.json`), JSON.stringify(snap));
    const files = readdirSync(this.versionsDir(id)).sort();
    while (files.length > 30) rmSync(join(this.versionsDir(id), files.shift()!), { force: true });
    return vid;
  }
  listVersions(id: string): { id: string; at: string; label: string }[] {
    return readdirSync(this.versionsDir(id))
      .sort()
      .reverse()
      .map((f) => {
        try {
          const v = JSON.parse(readFileSync(join(this.versionsDir(id), f), "utf8"));
          return { id: v.id, at: v.at, label: v.label };
        } catch {
          return null;
        }
      })
      .filter((v): v is { id: string; at: string; label: string } => !!v);
  }
  restoreVersion(id: string, vid: string) {
    const file = join(this.versionsDir(id), `${vid}.json`);
    if (!/^[\w-]+$/.test(vid) || !existsSync(file)) throw new Error("Version not found");
    const v = JSON.parse(readFileSync(file, "utf8"));
    this.saveVersion(id, "Before restoring an earlier version");
    writeFileSync(this.htmlPath(id), v.html);
    if (v.data) writeFileSync(this.dataPath(id), JSON.stringify(v.data));
    if (v.recipe) this.setRecipe(id, v.recipe);
    this.update(id, { hasHtml: true, htmlVersion: (this.get(id)?.htmlVersion ?? 0) + 1, datasets: v.datasets, dataFetchedAt: v.data?.fetchedAt });
  }

  setHtml(id: string, html: string) {
    writeFileSync(this.htmlPath(id), html);
    const m = this.get(id);
    // htmlVersion is what the viewer watches: it only moves when the page itself changes.
    this.update(id, { hasHtml: true, htmlVersion: (m?.htmlVersion ?? 0) + 1, status: m?.status === "draft" || m?.status === "building" ? "ready" : m?.status });
  }

  /** Adds a finished run's credits to the dashboard's running total. */
  addSpend(id: string, credits: number) {
    const m = this.get(id);
    if (!m) return;
    const spend = m.spend ?? { credits: 0, runs: 0 };
    this.update(id, { spend: { credits: Math.round((spend.credits + credits) * 10) / 10, runs: spend.runs + 1 } });
  }

  // ---- data ----
  dataPath(id: string) {
    return join(this.dir(id), "data.json");
  }
  getData(id: string): DataSnapshot | undefined {
    try {
      return JSON.parse(readFileSync(this.dataPath(id), "utf8"));
    } catch {
      return undefined;
    }
  }
  setData(id: string, snapshot: DataSnapshot) {
    const p = this.dataPath(id);
    if (existsSync(p)) {
      const prev = this.getData(id);
      const stamp = (prev?.fetchedAt ?? now()).replace(/[:.]/g, "-");
      renameSync(p, join(this.dir(id), "history", `${stamp}.json`));
      this.pruneHistory(id);
    }
    writeFileSync(p, JSON.stringify(snapshot));
    this.update(id, { dataFetchedAt: snapshot.fetchedAt, datasets: Object.keys(snapshot.datasets), staleSince: undefined, lastError: undefined });
  }
  private pruneHistory(id: string) {
    const h = join(this.dir(id), "history");
    const files = readdirSync(h).sort();
    while (files.length > HISTORY_KEEP) rmSync(join(h, files.shift()!), { force: true });
  }

  // ---- recipe ----
  recipePath(id: string) {
    return join(this.dir(id), "recipe.json");
  }
  getRecipe(id: string): Recipe | undefined {
    try {
      return JSON.parse(readFileSync(this.recipePath(id), "utf8"));
    } catch {
      return undefined;
    }
  }
  setRecipe(id: string, recipe: Recipe) {
    writeFileSync(this.recipePath(id), JSON.stringify(recipe, null, 2));
  }

  // ---- chat ----
  getChat(id: string): ChatMessage[] {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), "chat.json"), "utf8"));
    } catch {
      return [];
    }
  }
  appendChat(id: string, msg: ChatMessage) {
    const chat = this.getChat(id);
    chat.push(msg);
    writeFileSync(join(this.dir(id), "chat.json"), JSON.stringify(chat, null, 2));
  }

  // ---- refresh log ----
  getRefreshLog(id: string): RefreshLogEntry[] {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), "refresh-log.json"), "utf8"));
    } catch {
      return [];
    }
  }
  appendRefreshLog(id: string, entry: RefreshLogEntry) {
    const log = this.getRefreshLog(id).slice(-99);
    log.push(entry);
    writeFileSync(join(this.dir(id), "refresh-log.json"), JSON.stringify(log, null, 2));
  }

  // ---- thumbnail ----
  thumbnailPath(id: string) {
    return join(this.dir(id), "thumbnail.png");
  }
  setThumbnail(id: string, png: Buffer) {
    writeFileSync(this.thumbnailPath(id), png);
    const m = this.get(id);
    this.update(id, { thumbnailVersion: (m?.thumbnailVersion ?? 0) + 1 });
  }
  hasThumbnail(id: string) {
    return existsSync(this.thumbnailPath(id)) && statSync(this.thumbnailPath(id)).size > 0;
  }

  workDir(id: string) {
    const d = join(this.dir(id), "work");
    mkdirSync(d, { recursive: true });
    return d;
  }
}
