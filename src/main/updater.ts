import { app, shell } from "electron";
import updater, { type UpdateInfo } from "electron-updater";

// electron-updater is CommonJS; the main bundle is ESM, so take the default export.
const { autoUpdater } = updater;
import type { UpdateStatus } from "@shared/types";

/**
 * Update checks against the public GitHub releases (electron-builder's `publish` config).
 *
 * Until the app is code-signed, macOS won't let electron-updater install a downloaded update, so
 * this only *checks* and hands the user a download link. Once signing is in place, flip
 * `AUTO_INSTALL` and the same code downloads in the background and installs on quit.
 */
const AUTO_INSTALL = false;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export class Updater {
  private status: UpdateStatus = { state: "idle", current: app.getVersion() };
  private listeners = new Set<(s: UpdateStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private log: (m: string) => void = () => {}) {
    autoUpdater.autoDownload = AUTO_INSTALL;
    autoUpdater.autoInstallOnAppQuit = AUTO_INSTALL;
    autoUpdater.logger = null;
    autoUpdater.on("update-available", (info: UpdateInfo) => this.set({ state: "available", current: app.getVersion(), version: info.version, notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined, url: releaseUrl(info.version) }));
    autoUpdater.on("update-not-available", () => this.set({ state: "none", current: app.getVersion(), checkedAt: new Date().toISOString() }));
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => this.set({ state: "ready", current: app.getVersion(), version: info.version, url: releaseUrl(info.version) }));
    autoUpdater.on("error", (e) => {
      this.log(`update check: ${e.message}`);
      this.set({ state: "error", current: app.getVersion(), error: e.message.split("\n")[0]?.slice(0, 120) });
    });
  }

  onChange(fn: (s: UpdateStatus) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(s: UpdateStatus) {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }
  get() {
    return this.status;
  }

  /** Checks shortly after launch and every few hours; never in dev builds (nothing to compare to). */
  start() {
    if (!app.isPackaged) return;
    setTimeout(() => void this.check(), 8000);
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status;
    this.set({ ...this.status, state: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* reported through the error event */
    }
    return this.status;
  }

  /** Opens the download, or installs the already-downloaded update when signing allows it. */
  async install() {
    if (AUTO_INSTALL && this.status.state === "ready") {
      autoUpdater.quitAndInstall();
      return;
    }
    await shell.openExternal(this.status.url ?? "https://mydashie.com/download");
  }
}

function releaseUrl(version: string) {
  return `https://github.com/TreyBros/mydashie/releases/tag/v${version}`;
}
