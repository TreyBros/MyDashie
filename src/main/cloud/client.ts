import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AccountStatus } from "@shared/types";
import type { UsageEntry } from "@shared/pricing";

export interface CloudConfig {
  url?: string;
  anonKey?: string;
  /** The marketing site, which hosts sign-in, pricing and the account page. */
  webUrl: string;
}

/** Where the session lives between launches (the encrypted secrets store). */
export interface SessionStore {
  get(): Session | undefined;
  set(s: Session | undefined): void;
}

/** The keys the agent runs with, delivered per session from the cloud; never part of the app bundle. */
export interface AppKeys {
  openai: string;
  composio: string;
}

interface Account {
  email: string;
  plan: string;
  plan_name: string;
  balance: number;
  allowance: number;
  period_end: string;
  stripe_customer: boolean;
}

/**
 * The app's link to the MyDashie cloud: who the user is, what plan they're on and how many
 * credits they have. Every metered action is sent to `record_usage`, which prices it server
 * side and debits the balance; the app only ever learns credits back, never dollars. Usage is
 * queued on disk so a flaky connection never loses a charge or blocks the UI.
 */
export class CloudClient {
  private sb: SupabaseClient | null = null;
  private account: Account | null = null;
  private flushing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private keyListeners = new Set<(k: AppKeys | null) => void>();
  private keysAt = 0;
  /** An in-progress browser/email sign-in: the id the website will deposit the session under. */
  private login: { id: string; timer: ReturnType<typeof setInterval>; startedAt: number } | null = null;

  constructor(private cfg: CloudConfig, private sessions: SessionStore, private queueFile: string, private installId: () => string, private log: (m: string) => void = () => {}) {
    if (cfg.url && cfg.anonKey) {
      this.sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const s = sessions.get();
      if (s) void this.sb.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token }).then(() => this.refresh()).catch(() => {});
    }
  }

  configured() {
    return !!this.sb;
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }
  /** Called with fresh keys after sign-in (and periodically), and with null on sign-out. */
  onKeys(fn: (k: AppKeys | null) => void) {
    this.keyListeners.add(fn);
    return () => this.keyListeners.delete(fn);
  }

  /** Pulls the agent keys for this session from the cloud. Returns false when not signed in or out of credits. */
  async fetchKeys(force = false): Promise<boolean> {
    const s = await this.session();
    if (!s || !this.sb) return false;
    if (!force && Date.now() - this.keysAt < 6 * 60 * 60 * 1000) return true;
    const { data, error } = await this.sb.functions.invoke("app-config", { headers: { Authorization: `Bearer ${s.access_token}` } });
    if (error) {
      this.log(`keys: ${error.message}`);
      return false;
    }
    const k = data as Partial<AppKeys>;
    if (!k.openai || !k.composio) return false;
    this.keysAt = Date.now();
    for (const fn of this.keyListeners) fn({ openai: k.openai, composio: k.composio });
    return true;
  }

  /**
   * Sign-in happens in the browser or by email link. The app mints a login id, the website deposits
   * the session under it once the user is signed in, and the app polls to claim it; the mydashie://
   * deep link is only a shortcut. Returns the URL to open.
   */
  beginLogin(): string {
    this.cancelLogin();
    const id = randomBytes(32).toString("hex");
    const timer = setInterval(() => void this.pollLogin(), 2000);
    this.login = { id, timer, startedAt: Date.now() };
    this.changed();
    return this.loginUrl(id);
  }
  private loginUrl(id: string) {
    return `${this.cfg.webUrl}/auth/desktop?login=${id}&install=${encodeURIComponent(this.installId())}`;
  }
  loginPending() {
    return !!this.login;
  }
  cancelLogin() {
    if (this.login) clearInterval(this.login.timer);
    this.login = null;
  }
  private async pollLogin() {
    const l = this.login;
    if (!l || !this.sb) return;
    if (Date.now() - l.startedAt > 15 * 60 * 1000) {
      this.cancelLogin();
      this.changed();
      return;
    }
    const { data, error } = await this.sb.rpc("claim_desktop_login", { p_id: l.id });
    if (error) {
      this.log(`login poll: ${error.message}`);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { access_token?: string; refresh_token?: string } | undefined;
    if (!row?.access_token || !row.refresh_token) return;
    this.cancelLogin();
    await this.adoptSession(row.access_token, row.refresh_token);
  }

  /** Emails a sign-in link from inside the app; the link lands on the website, which completes the handshake. */
  async requestMagicLink(email: string): Promise<void> {
    if (!this.sb) throw new Error("Accounts aren't available in this build.");
    const url = this.login ? this.loginUrl(this.login.id) : this.beginLogin();
    const { error } = await this.sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: url, shouldCreateUser: true } });
    if (error) {
      // Nothing to wait for if the email never went out.
      this.cancelLogin();
      this.changed();
      throw new Error(/invalid/i.test(error.message) ? "That email address doesn't look right." : /rate|too many/i.test(error.message) ? "Too many sign-in emails just now. Try again in a minute." : error.message);
    }
  }

  /** The 8-digit code from the sign-in email, typed into the app: signs in with no browser at all. */
  async verifyCode(email: string, code: string): Promise<boolean> {
    if (!this.sb) throw new Error("Accounts aren't available in this build.");
    const token = code.replace(/\D/g, "");
    if (token.length < 6) throw new Error("Enter the whole code from the email.");
    const { data, error } = await this.sb.auth.verifyOtp({ email: email.trim(), token, type: "email" });
    if (error) throw new Error(/expired|invalid/i.test(error.message) ? "That code didn't work. Codes expire after an hour; request a new link to get a fresh one." : error.message);
    if (!data.session) return false;
    this.cancelLogin();
    return this.adoptSession(data.session.access_token, data.session.refresh_token);
  }

  private async adoptSession(access_token: string, refresh_token: string): Promise<boolean> {
    if (!this.sb) return false;
    const { data, error } = await this.sb.auth.setSession({ access_token, refresh_token });
    if (error || !data.session) {
      this.log(`sign-in failed: ${error?.message}`);
      return false;
    }
    // Take our own refresh token right away so the browser's copy is retired.
    const r = await this.sb.auth.refreshSession();
    this.sessions.set(r.data.session ?? data.session);
    await this.refresh();
    await this.fetchKeys(true);
    void this.flush();
    return true;
  }

  /** Kept for the website's "Open MyDashie" button. */
  signInUrl() {
    return this.beginLogin();
  }

  /** mydashie://auth#access_token=…&refresh_token=… */
  async handleCallback(url: string): Promise<boolean> {
    if (!this.sb) return false;
    const hash = url.split("#")[1] ?? "";
    const p = new URLSearchParams(hash);
    const access_token = p.get("access_token");
    const refresh_token = p.get("refresh_token");
    if (!access_token || !refresh_token) return false;
    this.cancelLogin();
    return this.adoptSession(access_token, refresh_token);
  }

  async signOut() {
    await this.sb?.auth.signOut().catch(() => {});
    this.sessions.set(undefined);
    this.account = null;
    this.keysAt = 0;
    for (const fn of this.keyListeners) fn(null);
    this.changed();
  }

  /** A valid session, refreshing the token when needed; null when signed out. */
  private async session(): Promise<Session | null> {
    if (!this.sb) return null;
    const { data } = await this.sb.auth.getSession();
    let s = data.session;
    if (s && s.expires_at && s.expires_at * 1000 < Date.now() + 60_000) {
      const r = await this.sb.auth.refreshSession();
      s = r.data.session;
    }
    if (s && s.access_token !== this.sessions.get()?.access_token) this.sessions.set(s);
    if (!s) this.account = null;
    return s;
  }

  /** Re-reads plan and credits from the server. */
  async refresh() {
    if (!(await this.session())) return;
    const { data, error } = await this.sb!.rpc("my_account");
    if (error) {
      this.log(`account: ${error.message}`);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Account | undefined;
    if (row) this.account = row;
    this.changed();
  }

  async status(): Promise<AccountStatus> {
    const configured = this.configured();
    const signedIn = configured && !!(await this.session());
    if (signedIn && !this.account) await this.refresh();
    const a = signedIn ? this.account : null;
    return {
      configured,
      signedIn,
      email: a?.email ?? (await this.session())?.user.email,
      plan: a?.plan,
      planName: a?.plan_name,
      balance: a?.balance,
      allowance: a?.allowance,
      periodEnd: a?.period_end,
      pending: this.queue().length,
      webUrl: this.cfg.webUrl,
      loginPending: !!this.login,
    };
  }

  /** Why the user can't start a model run right now, or null. Refreshes are never blocked. */
  async gate(): Promise<string | null> {
    if (!this.configured()) return null;
    if (!(await this.session())) return "Sign in to MyDashie to build dashboards (Settings → Account).";
    if (!this.account) await this.refresh();
    if (this.account && this.account.balance <= 0) return "You're out of credits. Add credits or upgrade in Settings → Account.";
    if (!(await this.fetchKeys())) return "Couldn't reach MyDashie to start this run. Check your connection and try again.";
    return null;
  }

  // ---- usage ----
  private queue(): UsageEntry[] {
    if (!existsSync(this.queueFile)) return [];
    return readFileSync(this.queueFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as UsageEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is UsageEntry => !!e);
  }

  /** Queues an action for the server to price and debit; flushes in the background. */
  recordUsage(entry: UsageEntry) {
    if (!this.configured()) return;
    appendFileSync(this.queueFile, JSON.stringify(entry) + "\n");
    void this.flush();
  }

  /** Sends queued actions; a caller awaiting a flush that's already running waits for that one. */
  flush(): Promise<void> {
    if (!this.sb) return Promise.resolve();
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushNow() {
    const sb = this.sb;
    if (!sb) return;
    {
      if (!(await this.session())) return;
      const pending = this.queue();
      const left: UsageEntry[] = [];
      for (const e of pending) {
        const { data, error } = await sb.rpc("record_usage", {
          p_client_id: `${this.installId()}:${e.id}`,
          p_install_id: this.installId(),
          p_dashboard_id: e.dashboardId,
          p_kind: e.kind,
          p_level: e.level ?? null,
          p_model: e.model ?? null,
          p_input: e.usage?.input ?? 0,
          p_cached: e.usage?.cached ?? 0,
          p_output: e.usage?.output ?? 0,
          p_tool_calls: e.toolCalls,
          p_previews: e.previews ?? 0,
          p_duration_ms: e.durationMs,
          p_ok: e.ok,
          p_meta: {},
        });
        if (error) {
          this.log(`usage sync: ${error.message}`);
          left.push(e);
          if (/not signed in|JWT/i.test(error.message)) break;
          continue;
        }
        const row = (Array.isArray(data) ? data[0] : data) as { balance: number; allowance: number; period_end: string; plan: string } | undefined;
        if (row && this.account) Object.assign(this.account, { balance: row.balance, allowance: row.allowance, period_end: row.period_end, plan: row.plan });
      }
      writeFileSync(this.queueFile, left.map((e) => JSON.stringify(e)).join("\n") + (left.length ? "\n" : ""));
      if (left.length < pending.length) this.changed();
    }
  }

  // ---- billing ----
  async checkoutUrl(kind: "plan" | "pack", id: string): Promise<string> {
    const s = await this.session();
    if (!s || !this.sb) throw new Error("Sign in first");
    const { data, error } = await this.sb.functions.invoke("create-checkout", { body: { kind, id }, headers: { Authorization: `Bearer ${s.access_token}` } });
    if (error) throw new Error(error.message);
    return (data as { url: string }).url;
  }

  /** A one-time link that opens the website already signed in as this user. */
  async webUrl(next: string): Promise<string> {
    const s = await this.session();
    if (!s || !this.sb) return `${this.cfg.webUrl}${next}`;
    const { data, error } = await this.sb.functions.invoke("web-handoff", { body: { next }, headers: { Authorization: `Bearer ${s.access_token}` } });
    if (error || !(data as { url?: string })?.url) {
      this.log(`web handoff: ${error?.message ?? "no url"}`);
      return `${this.cfg.webUrl}${next}`;
    }
    return (data as { url: string }).url;
  }

  async portalUrl(): Promise<string> {
    const s = await this.session();
    if (!s || !this.sb) throw new Error("Sign in first");
    const { data, error } = await this.sb.functions.invoke("billing-portal", { headers: { Authorization: `Bearer ${s.access_token}` } });
    if (error) throw new Error(error.message);
    return (data as { url: string }).url;
  }
}
