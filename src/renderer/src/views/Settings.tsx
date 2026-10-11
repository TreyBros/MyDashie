import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { GlyphCheck, GlyphClose, GlyphPlus, Pic } from "../components/icons";

import { toast } from "sonner";
import { useStore, type SettingsTab, friendlyError } from "../lib/store";
import { LiveMascot } from "../components/LiveMascot";
import { SignInCard } from "../components/SignIn";
import { Button, Chip, Field, IconButton, Input, Mascot, SectionTitle, Select, Toggle } from "../components/ui";
import { effortsFor, DEFAULT_BUILD_MODEL, DEFAULT_REFRESH_MODEL } from "@shared/models";
import { CREDIT, formatCredits, type UsageSummary } from "@shared/pricing";
import { POWER, POWER_LEVELS, type PowerChoice } from "@shared/power";
import type { AccountStatus, ConnectionInfo, McpServerConfig, ModelInfo, ReasoningEffort, UpdateStatus } from "@shared/types";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "apps", label: "Apps & data" },
  { id: "ai", label: "AI" },
  { id: "mcp", label: "MCP servers" },
  { id: "general", label: "General" },
];

export function SettingsView({ tab: initial }: { tab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initial ?? "apps");
  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);
  return (
    <div className="flex h-full flex-col">
      <header className="drag px-8 pt-10 pb-4">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <div className="no-drag mt-3 flex gap-1 rounded-full bg-surface-2 p-1 w-fit">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={clsx("rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors", tab === t.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-8 pb-10">
        <div className="max-w-[640px] space-y-8">
          {tab === "account" && <AccountTab />}
          {tab === "ai" && <AiTab />}
          {tab === "apps" && <AppsTab />}
          {tab === "mcp" && <McpTab />}
          {tab === "general" && <GeneralTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------- Account ----------------

/** Sign-in, plan and credits. Dollars never appear here. */
function AccountTab() {
  const [acct, setAcct] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => window.dash.account.status().then(setAcct).catch(() => setAcct(null));
  useEffect(() => {
    void load();
    return window.dash.account.onChanged(() => void load());
  }, []);
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };
  if (!acct) return null;
  if (!acct.configured)
    return (
      <section>
        <SectionTitle>Account</SectionTitle>
        <div className="card p-4 text-[13px] text-muted">This build runs without an account: nothing to sign in to, and credits aren't tracked beyond this Mac.</div>
      </section>
    );
  if (!acct.signedIn)
    return (
      <section>
        <SectionTitle>Account</SectionTitle>
        <SignInCard acct={acct} />
      </section>
    );
  const pct = acct.allowance ? Math.max(0, Math.min(1, (acct.balance ?? 0) / acct.allowance)) : 0;
  const low = (acct.balance ?? 0) <= (acct.allowance ?? 0) * 0.2;
  const renews = acct.periodEnd ? new Date(acct.periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  return (
    <>
      <section>
        <SectionTitle>Account</SectionTitle>
        <div className="card divide-y divide-line">
          <div className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <div className="text-sm font-medium">{acct.email}</div>
              <div className="text-[12.5px] text-muted">{acct.planName ?? acct.plan} plan{renews ? ` · renews ${renews}` : ""}</div>
            </div>
            <Chip tone={acct.plan === "free" ? "neutral" : "lilac"}>{acct.planName ?? acct.plan}</Chip>
          </div>
          <div className="p-4">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium">Credits</div>
              <div className="text-[22px] font-semibold tabular-nums tracking-tight">
                {formatCredits(Math.max(0, acct.balance ?? 0))} <span className="text-[12px] font-normal text-muted">of {formatCredits(acct.allowance ?? 0)} left</span>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className={clsx("h-full rounded-full transition-[width] duration-500", low ? "bg-peach" : "bg-lilac")} style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-muted">
              Every build, edit and refresh uses credits; dashboards are unlimited. {acct.pending > 0 ? `${acct.pending} recent action${acct.pending === 1 ? "" : "s"} still syncing.` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" size="sm" loading={busy === "pack"} onClick={() => void act("pack", () => window.dash.account.checkout({ kind: "pack", id: "pack_50" }))}>Add credits</Button>
              <Button size="sm" loading={busy === "web"} onClick={() => void act("web", () => window.dash.account.openWeb({ next: "/pricing" }))}>Change plan</Button>
              <Button size="sm" loading={busy === "portal"} onClick={() => void act("portal", () => window.dash.account.portal())}>Manage billing</Button>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="text-[12.5px] text-muted">Signed in on this Mac</div>
            <Button size="sm" variant="ghost" onClick={() => void act("signout", () => window.dash.account.signOut())}>Sign out</Button>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------- AI ----------------

function KeyRow({ name, present, placeholder, onSave, onClear, help }: { name: "openai" | "composio"; present: boolean; placeholder: string; onSave: (v: string) => Promise<void>; onClear: () => Promise<void>; help: React.ReactNode }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!present);
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{name === "openai" ? "OpenAI API key" : "Composio API key"}</div>
        {present && !editing && <Chip tone="mint"><GlyphCheck size={12} /> Connected</Chip>}
      </div>
      <div className="mt-1 text-[12.5px] text-muted">{help}</div>
      {editing ? (
        <div className="mt-3 flex gap-2">
          <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
          <Button
            variant="primary"
            loading={busy}
            disabled={value.trim().length < 8}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(value.trim());
                setValue("");
                setEditing(false);
                toast.success("Key saved");
              } catch (e) {
                toast.error(friendlyError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
          {present && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>Replace key</Button>
          <Button size="sm" variant="ghost" onClick={() => void onClear()}>Remove</Button>
        </div>
      )}
    </div>
  );
}

function AiTab() {
  const settings = useStore((s) => s.settings)!;
  const secrets = useStore((s) => s.secrets);
  const loadSettings = useStore((s) => s.loadSettings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    setLoadingModels(true);
    window.dash.models.list().then(setModels).catch((e) => toast.error(String(e.message ?? e))).finally(() => setLoadingModels(false));
  }, []);

  const setModel = async (which: "buildModel" | "refreshModel", patch: Partial<{ model: string; effort: ReasoningEffort }>) => {
    const cur = settings[which];
    const next = { ...cur, ...patch };
    if (!effortsFor(next.model).includes(next.effort)) next.effort = "medium";
    await window.dash.settings.set({ [which]: next });
    await loadSettings();
  };

  const power: PowerChoice = settings.power ?? "auto";
  const setPower = async (p: PowerChoice) => {
    await window.dash.settings.set({ power: p });
    await loadSettings();
  };
  const account = useStore((s) => s.account);
  const selfHosted = !!account && !account.configured;
  const saveKey = (key: "openai" | "composio") => async (value: string) => {
    await window.dash.secrets.set({ key, value });
    await loadSettings();
  };
  const clearKey = (key: "openai" | "composio") => async () => {
    await window.dash.secrets.clear(key);
    await loadSettings();
  };
  return (
    <>
      {selfHosted && (
        <section>
          <SectionTitle>Your keys</SectionTitle>
          <div className="space-y-3">
            <KeyRow name="openai" present={secrets.openai} placeholder="sk-…" onSave={saveKey("openai")} onClear={clearKey("openai")} help={<>Dashie writes dashboards with OpenAI models. Create a key at <Ext href="https://platform.openai.com/api-keys">platform.openai.com</Ext>; you pay OpenAI directly for what you use.</>} />
            <KeyRow name="composio" present={secrets.composio} placeholder="ak_…" onSave={saveKey("composio")} onClear={clearKey("composio")} help={<>Connected apps (Gmail, GitHub, HubSpot, …) go through Composio. Get a key at <Ext href="https://platform.composio.dev">platform.composio.dev</Ext>. Optional: without it you can still use local files, public APIs and your own MCP servers.</>} />
          </div>
          <p className="mt-2 text-[12px] text-muted">Keys are stored encrypted on this Mac and never leave it except to call those services. Prefer not to manage keys? <Ext href="https://mydashie.com">MyDashie Cloud</Ext> includes them.</p>
        </section>
      )}
      <section>
        <SectionTitle>Dashie's power</SectionTitle>
        <div className="card p-4">
          <div className="text-[12.5px] text-muted">How hard Dashie thinks on each request. Higher levels use more credits per action. Questions about a dashboard always run Quick.</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {(["auto", ...POWER_LEVELS] as PowerChoice[]).map((p) => {
              const on = power === p;
              const info = p === "auto" ? { label: "Auto", blurb: "Dashie picks per request. Smart for most work, Max for big asks.", multiplier: null } : POWER[p];
              return (
                <button key={p} onClick={() => void setPower(p)} className={clsx("pressable rounded-2xl border p-3 text-left", on ? "border-lilac bg-lilac-soft/60" : "border-line hover:border-lilac/40")} aria-pressed={on}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13.5px] font-semibold">{info.label}</span>
                    {info.multiplier !== null && <span className="text-[11px] text-muted">{info.multiplier}× credits</span>}
                  </div>
                  <div className="mt-1 text-[12px] leading-snug text-muted">{info.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      {settings.developer && (
      <section>
        <SectionTitle>Models (developer)</SectionTitle>
        <div className="card divide-y divide-line">
          <ModelRow
            title="Building & editing"
            hint="Writes the dashboard code. A stronger model makes nicer dashboards."
            value={settings.buildModel}
            models={models}
            loading={loadingModels}
            fallback={DEFAULT_BUILD_MODEL}
            onChange={(p) => void setModel("buildModel", p)}
          />
          <ModelRow
            title="Repairs during refresh"
            hint="Only runs when a scheduled refresh breaks. Cheap and fast is fine."
            value={settings.refreshModel}
            models={models}
            loading={loadingModels}
            fallback={DEFAULT_REFRESH_MODEL}
            onChange={(p) => void setModel("refreshModel", p)}
          />
        </div>
        <p className="mt-2 text-[12px] text-muted">Overrides the power level for builds and edits while developer mode is on.</p>
      </section>
      )}
    </>
  );
}

function ModelRow({ title, hint, value, models, loading, fallback, onChange }: { title: string; hint: string; value: { model: string; effort: ReasoningEffort }; models: ModelInfo[]; loading: boolean; fallback: string; onChange: (p: Partial<{ model: string; effort: ReasoningEffort }>) => void }) {
  const list = models.length ? models : [{ id: value.model || fallback, label: value.model || fallback, tier: "other" as const }];
  const grouped = { flagship: "Flagship", balanced: "Balanced", efficient: "Efficient", other: "Other" } as const;
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[12.5px] text-muted">{hint}</div>
      </div>
      <Select value={value.model} disabled={loading} onChange={(e) => onChange({ model: e.target.value })} className="w-52">
        {(Object.keys(grouped) as (keyof typeof grouped)[]).map((tier) => {
          const items = list.filter((m) => m.tier === tier);
          if (!items.length) return null;
          return (
            <optgroup key={tier} label={grouped[tier]}>
              {items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.recommendedFor ? " (recommended)" : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
      </Select>
      <Select value={value.effort} onChange={(e) => onChange({ effort: e.target.value as ReasoningEffort })} className="w-28" title="Reasoning effort">
        {effortsFor(value.model).map((e) => (
          <option key={e} value={e}>{e}</option>
        ))}
      </Select>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-0.5 text-lilac underline-offset-2 hover:underline" onClick={() => void window.dash.app.openExternal(href)}>
      {children} <Pic name="link" size={12} />
    </button>
  );
}

// ---------------- Apps ----------------

function AppsTab() {
  const secrets = useStore((s) => s.secrets);
  const loadSettings = useStore((s) => s.loadSettings);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConnectionInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [local, setLocal] = useState<{ id: string; name: string; hint: string; available: boolean }[]>([]);

  const reload = () => {
    window.dash.connections.list().then(setConnections).catch(() => {});
  };
  useEffect(reload, []);
  useEffect(() => {
    window.dash.local.sources().then(setLocal).catch(() => {});
    return window.dash.dashboards.onChanged(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!query.trim()) return setResults([]);
    const t = setTimeout(() => {
      setSearching(true);
      window.dash.connections.search(query.trim()).then(setResults).catch(() => setResults([])).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const connect = async (toolkit: string) => {
    try {
      await window.dash.connections.connect(toolkit);
      toast("Finish connecting in your browser, then come back.");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  return (
    <>
      {(
        <section>
          <SectionTitle action={<IconButton label="Reload" onClick={reload}><Pic name="refresh" size={18} /></IconButton>}>Connected apps</SectionTitle>
          {connections.length === 0 ? (
            <div className="card flex items-center gap-4 p-4">
              <LiveMascot mood="connecting" size={72} interval={3000} />
              <div className="text-[13px] text-muted">No apps connected yet. Search below, or just ask for a dashboard and Dashie will ask to connect what it needs.</div>
            </div>
          ) : (
            <div className="card divide-y divide-line">
              {connections.map((c) => (
                <div key={c.toolkit} className="flex items-center gap-3 p-3">
                  <Logo c={c} />
                  <div className="flex-1 text-sm font-medium">{c.name}</div>
                  <Chip tone="mint"><GlyphCheck size={12} /> Connected</Chip>
                  {c.connectedAccountId && (
                    <IconButton label="Disconnect" onClick={async () => { await window.dash.connections.disconnect(c.connectedAccountId!); reload(); }}>
                      <GlyphClose size={16} />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 1,600+ apps: Stripe, HubSpot, Google Sheets, Granola…" />
            <p className="mt-2 text-[11.5px] text-muted">App connections are powered by Composio, so you'll see that name when an app asks you to approve access. Dashie only ever reads.</p>
            {(results.length > 0 || searching) && (
              <div className="card mt-2 divide-y divide-line">
                {searching && results.length === 0 && <div className="p-3 text-[12.5px] text-muted">Searching…</div>}
                {results.map((c) => (
                  <div key={c.toolkit} className="flex items-center gap-3 p-3">
                    <Logo c={c} />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{c.name}</div>
                                          </div>
                    {c.connected ? <Chip tone="mint">Connected</Chip> : <Button size="sm" variant="soft" onClick={() => void connect(c.toolkit)}><Pic name="apps" size={16} /> Connect</Button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>On this Mac</SectionTitle>
        <div className="card divide-y divide-line">
          {local.map((s) => (
            <div key={s.id} className="flex items-start gap-3 p-3">
              <div className="flex-1">
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-[12px] text-muted">{s.hint}</div>
              </div>
              <Chip tone={s.available ? "mint" : "neutral"}>{s.available ? "Available" : "Not found"}</Chip>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Logo({ c }: { c: ConnectionInfo }) {
  return (
    <span className="inline-flex size-8 items-center justify-center overflow-hidden rounded-xl bg-surface-2">
      {c.logo ? <img src={c.logo} alt="" className="size-5 object-contain" /> : <span className="text-[12px] font-semibold text-muted">{c.name[0]}</span>}
    </span>
  );
}

// ---------------- MCP ----------------

const MCP_PRESETS: { name: string; transport: McpServerConfig["transport"]; note: string }[] = [
  { name: "Filesystem (read-only)", transport: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"] }, note: "Lets Dashie list and read files in a folder." },
  { name: "Postgres", transport: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost:5432/db"] }, note: "Query a Postgres database. Edit the connection string." },
];

function McpTab() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [adding, setAdding] = useState(false);
  const reload = () => window.dash.mcp.list().then(setServers);
  useEffect(() => void reload(), []);

  return (
    <>
      <section>
        <SectionTitle action={<Button size="sm" variant="soft" onClick={() => setAdding(true)}><GlyphPlus size={14} /> Add server</Button>}>Your MCP servers</SectionTitle>
        <p className="mb-3 text-[12.5px] text-muted">Any MCP server you add becomes a data source Dashie can use: internal APIs, databases, company tools.</p>
        {servers.length === 0 ? (
          <div className="card p-4 text-[13px] text-muted">No custom servers yet.</div>
        ) : (
          <div className="card divide-y divide-line">
            {servers.map((s) => (
              <ServerRow key={s.id} s={s} onChange={() => void reload()} />
            ))}
          </div>
        )}
      </section>
      {adding && <ServerForm onClose={() => { setAdding(false); void reload(); }} />}
    </>
  );
}

function ServerRow({ s, onChange }: { s: McpServerConfig; onChange: () => void }) {
  const [testing, setTesting] = useState(false);
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{s.name}</div>
        <div className="truncate font-mono text-[11.5px] text-muted">{s.transport.type === "http" ? s.transport.url : `${s.transport.command} ${s.transport.args.join(" ")}`}</div>
      </div>
      <Button
        size="sm"
        loading={testing}
        onClick={async () => {
          setTesting(true);
          const r = await window.dash.mcp.test(s);
          setTesting(false);
          r.ok ? toast.success(`Connected: ${r.tools.length} tool${r.tools.length === 1 ? "" : "s"}`) : toast.error(r.error ?? "Failed");
        }}
      >
        Test
      </Button>
      <Toggle checked={s.enabled} onChange={async (v) => { await window.dash.mcp.update({ ...s, enabled: v }); onChange(); }} label="Enabled" />
      <IconButton label="Remove" onClick={async () => { await window.dash.mcp.remove(s.id); onChange(); }}><Pic name="trash" size={18} /></IconButton>
    </div>
  );
}

function ServerForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);

  const build = (): Omit<McpServerConfig, "id"> => ({
    name: name.trim(),
    enabled: true,
    transport:
      type === "http"
        ? { type: "http", url: url.trim(), headers: parseHeaders(headers) }
        : { type: "stdio", command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [] },
  });

  return (
    <div className="card pop-in p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Add MCP server</div>
        <IconButton label="Close" onClick={onClose}><GlyphClose size={16} /></IconButton>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {MCP_PRESETS.map((p) => (
          <button key={p.name} title={p.note} onClick={() => { setName(p.name); setType(p.transport.type); if (p.transport.type === "stdio") { setCommand(p.transport.command); setArgs(p.transport.args.join(" ")); } }} className="rounded-full border border-line px-3 py-1 text-[12px] hover:border-line-strong">
            {p.name}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Internal metrics API" /></Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as "stdio" | "http")} className="w-full">
            <option value="stdio">Local command (stdio)</option>
            <option value="http">Remote URL (Streamable HTTP)</option>
          </Select>
        </Field>
        {type === "stdio" ? (
          <>
            <Field label="Command"><Input value={command} onChange={(e) => setCommand(e.target.value)} /></Field>
            <Field label="Arguments" hint="Space-separated."><Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem ~/Documents" /></Field>
          </>
        ) : (
          <>
            <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" /></Field>
            <Field label="Headers" hint="One per line, Name: value"><Input value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Authorization: Bearer …" /></Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim() || (type === "http" ? !url.trim() : !command.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                const cfg = build();
                const r = await window.dash.mcp.test({ ...cfg, id: "test" });
                if (!r.ok) {
                  toast.error(r.error ?? "Couldn't connect");
                  return;
                }
                await window.dash.mcp.add(cfg);
                toast.success(`Added ${cfg.name} (${r.tools.length} tools)`);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Test & add
          </Button>
        </div>
      </div>
    </div>
  );
}

function parseHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split(/\n|,/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// ---------------- General ----------------

function GeneralTab() {
  const settings = useStore((s) => s.settings)!;
  const loadSettings = useStore((s) => s.loadSettings);
  const [version, setVersion] = useState("");
  const [taps, setTaps] = useState(0);
  useEffect(() => void window.dash.app.version().then(setVersion), []);
  const set = async (p: Parameters<typeof window.dash.settings.set>[0]) => {
    await window.dash.settings.set(p);
    await loadSettings();
  };
  // Five taps on the version line toggles the pricing lab (real costs behind the credits).
  const tapVersion = async () => {
    const n = taps + 1;
    setTaps(n);
    if (n >= 5) {
      setTaps(0);
      await set({ developer: !settings.developer });
      toast.success(settings.developer ? "Pricing lab hidden" : "Pricing lab unlocked");
    }
  };
  return (
    <>
      <UsageSection developer={!!settings.developer} />
      <section>
        <SectionTitle>Appearance</SectionTitle>
        <div className="card flex items-center justify-between p-4">
          <div className="text-sm font-medium">Theme</div>
          <Select value={settings.theme} onChange={(e) => void set({ theme: e.target.value as "system" | "light" | "dark" })} className="w-40">
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </div>
      </section>
      <section>
        <SectionTitle>Background</SectionTitle>
        <div className="card divide-y divide-line">
          <Row title="Launch at login" hint="Keeps schedules running from the menu bar after you restart.">
            <Toggle checked={settings.launchAtLogin} onChange={(v) => void set({ launchAtLogin: v })} />
          </Row>
          <Row title="Notifications" hint="Tell me when a refresh needs attention or was repaired.">
            <Toggle checked={settings.notifications} onChange={(v) => void set({ notifications: v })} />
          </Row>
        </div>
        <p className="mt-2 text-[12px] text-muted">Closing the window keeps MyDashie running in the menu bar so schedules keep going. Quit from the menu bar icon.</p>
      </section>
      <UpdateRow version={version} onTapVersion={() => void tapVersion()} />
    </>
  );
}

/** Version line plus a check-for-updates button; the five-tap easter egg lives on the version text. */
function UpdateRow({ version, onTapVersion }: { version: string; onTapVersion: () => void }) {
  const [st, setSt] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    window.dash.app.updateStatus().then(setSt).catch(() => {});
    return window.dash.app.onUpdate(setSt);
  }, []);
  const label =
    st?.state === "checking" ? "Checking…" : st?.state === "available" ? `Version ${st.version} is available` : st?.state === "ready" ? `Version ${st.version} is ready to install` : st?.state === "none" ? "You're up to date" : st?.state === "error" ? "Couldn't check for updates" : "";
  return (
    <section className="flex items-center justify-between text-[12px] text-muted">
      <span className="select-none" onClick={onTapVersion}>MyDashie {version}{label ? ` · ${label}` : ""}</span>
      {st?.state === "available" || st?.state === "ready" ? (
        <Button size="sm" variant="primary" onClick={() => void window.dash.app.installUpdate()}>{st.state === "ready" ? "Restart to update" : "Download update"}</Button>
      ) : (
        <Button size="sm" variant="ghost" loading={st?.state === "checking"} onClick={() => window.dash.app.checkForUpdates().then(setSt)}>Check for updates</Button>
      )}
    </section>
  );
}

const KIND_LABEL: Record<string, string> = { build: "Builds", edit: "Edits", ask: "Questions", refresh: "Refreshes", heal: "Repairs", adjust: "Refunds" };

/** Credits used this month. With the pricing lab on, also the real cost behind them. */
function UsageSection({ developer }: { developer: boolean }) {
  const [sum, setSum] = useState<UsageSummary | null>(null);
  useEffect(() => {
    (window.dash.usage.summary(null) as Promise<UsageSummary>).then(setSum).catch(() => setSum(null));
  }, []);
  const month = new Date().toLocaleDateString(undefined, { month: "long" });
  const kinds = (["build", "edit", "ask", "refresh", "heal", "adjust"] as const).filter((k) => (sum?.byKind[k]?.count ?? 0) > 0);
  return (
    <section>
      <SectionTitle>Usage</SectionTitle>
      <div className="card p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm font-semibold">{month}</div>
            <div className="text-[12.5px] text-muted">Every build, edit and refresh uses credits. Dashboards themselves are unlimited.</div>
          </div>
          <div className="text-right">
            <div className="text-[26px] font-semibold tabular-nums tracking-tight">{sum ? formatCredits(sum.credits) : "–"}</div>
            <div className="-mt-1 text-[11.5px] text-muted">credits</div>
          </div>
        </div>
        {kinds.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-line pt-3 text-[12.5px] sm:grid-cols-4">
            {kinds.map((k) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <span className="text-muted">{KIND_LABEL[k]}</span>
                <span className="tabular-nums text-ink">
                  {formatCredits(sum!.byKind[k].credits)} <span className="text-muted">({sum!.byKind[k].count})</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {developer && sum && <PricingLab sum={sum} />}
    </section>
  );
}

/** Internal: what the credits really cost, and what to charge for them. */
function PricingLab({ sum }: { sum: UsageSummary }) {
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
  const kinds = (["build", "edit", "ask", "refresh", "heal", "adjust"] as const).filter((k) => sum.byKind[k].count > 0);
  return (
    <div className="card mt-3 border-dashed p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Pricing lab</div>
        <Button size="sm" onClick={async () => { const p = await window.dash.usage.export(); if (p) toast.success("Exported usage CSV"); }}>Export CSV</Button>
      </div>
      <div className="mt-1 text-[12.5px] text-muted">Private. Real spend behind this month's credits, and the price per credit that hits the target margin.</div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="True cost" value={usd(sum.costUsd)} />
        <Stat label="Cost per credit" value={usd(sum.costPerCredit)} hint={`anchor ${usd(CREDIT.usdPerCredit)}`} />
        <Stat label={`Price at ${Math.round(CREDIT.targetMargin * 100)}% margin`} value={usd(sum.suggestedPrice)} hint="per credit" />
        <Stat label="Actions" value={String(sum.count)} />
      </div>
      {kinds.length > 0 && (
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr><th className="py-1">Kind</th><th className="py-1 text-right">Count</th><th className="py-1 text-right">Avg credits</th><th className="py-1 text-right">Avg cost</th><th className="py-1 text-right">Cost / credit</th></tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const b = sum.byKind[k];
              return (
                <tr key={k} className="border-t border-line">
                  <td className="py-1.5">{KIND_LABEL[k]}</td>
                  <td className="py-1.5 text-right tabular-nums">{b.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCredits(b.credits / b.count)}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(b.costUsd / b.count)}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(b.credits ? b.costUsd / b.credits : 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[16px] font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[12.5px] text-muted">{hint}</div>
      </div>
      {children}
    </div>
  );
}
