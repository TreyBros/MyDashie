import { app, BrowserWindow, shell, safeStorage, Notification, powerMonitor, nativeTheme } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Paths } from "./store/paths";
import { SettingsStore } from "./store/settings";
import { SecretsStore, plainCipher, type Cipher } from "./store/secrets";
import { McpServerStore } from "./store/mcpServers";
import { DashboardRepo } from "./dashboards/repo";
import { registerDashScheme, handleDashProtocol } from "./dashboards/serve";
import { ComposioConnector } from "./connectors/composio";
import { AgentHarness } from "./agent/harness";
import { Scheduler } from "./scheduler";
import { UsageLedger } from "./store/usage";
import { ElectronPreview } from "./preview";
import { registerIpc } from "./ipc";
import { createTray, showWindow } from "./tray";
import { discoverLocalSources } from "./localSources";
import { managedKeys, cloudConfig } from "./managedKeys";
import { CloudClient } from "./cloud/client";
import { Updater } from "./updater";
import type { AppContext } from "./context";
import { IPC } from "@shared/ipc";
import type { McpServerConfig } from "@shared/types";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = !app.isPackaged;

registerDashScheme();
if (process.platform === "darwin") app.setName("MyDashie");
// Test hook: isolate user data (used by packaged-app checks).
if (process.env.DASH_USER_DATA) app.setPath("userData", process.env.DASH_USER_DATA);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
// mydashie:// links bring sign-in sessions back from the browser. Only the installed app may own the
// scheme: a dev run that registered itself would hijack links meant for the real app.
if (app.isPackaged && !process.env.DASH_USER_DATA) app.setAsDefaultProtocolClient("mydashie");

let mainWindow: BrowserWindow | null = null;
let ctx: AppContext;
/** A mydashie:// link that arrived before the app finished launching. */
let pendingDeepLink: string | null = null;
let handleDeepLink: ((url: string) => Promise<void>) | null = null;
app.on("open-url", (e, url) => {
  e.preventDefault();
  if (handleDeepLink) void handleDeepLink(url);
  else pendingDeepLink = url;
});

function resourcesDir() {
  return isDev ? join(__dirname, "../../resources") : process.resourcesPath;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111115" : "#FAFAF7",
    vibrancy: undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM preload requires an unsandboxed preload; the renderer stays isolated.
      webSecurity: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (!(app as typeof app & { isQuitting?: boolean }).isQuitting && process.platform === "darwin") {
      e.preventDefault();
      win.hide();
      app.dock?.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // A link clicked inside a dashboard frame must never navigate the frame away; open it in the browser instead.
  win.webContents.on("will-frame-navigate", (e) => {
    if (e.isMainFrame) return;
    if (/^(https?:\/\/|mailto:)/.test(e.url)) {
      e.preventDefault();
      void shell.openExternal(e.url);
    }
  });
  win.webContents.on("will-navigate", (e, url) => {
    const allowed = isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "http://localhost") : url.startsWith("file://");
    if (!allowed) e.preventDefault();
  });
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    if (details.url.startsWith("dash://") || details.resourceType === "subFrame") return cb({ responseHeaders: details.responseHeaders });
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            ? "default-src 'self' http://localhost:* ws://localhost:*; script-src 'self' http://localhost:* 'unsafe-inline'; style-src 'self' 'unsafe-inline' http://localhost:*; img-src 'self' data: blob: dash: http://localhost:* https:; font-src 'self' data: http://localhost:*; frame-src dash:; connect-src 'self' http://localhost:* ws://localhost:*"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: dash: https:; font-src 'self' data:; frame-src dash:; connect-src 'self'",
        ],
      },
    });
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
  return win;
}

/** One-time move of data from the app's previous name ("Dash SSR") so existing dashboards carry over. */
function migrateFromOldName() {
  try {
    const current = app.getPath("userData");
    const old = join(app.getPath("appData"), "Dash SSR");
    if (old === current || !existsSync(old)) return;
    if (existsSync(join(current, "dashboards")) && readdirSync(join(current, "dashboards")).length) return;
    mkdirSync(current, { recursive: true });
    for (const item of ["dashboards", "settings.json", "mcp-servers.json"]) {
      const from = join(old, item);
      if (existsSync(from)) cpSync(from, join(current, item), { recursive: true, force: false, errorOnExist: false });
    }
    console.log("[migrate] copied data from", old);
  } catch (e) {
    console.error("[migrate] failed", e);
  }
}

app.whenReady().then(() => {
  if (!process.env.DASH_USER_DATA) migrateFromOldName();
  const paths = new Paths(app.getPath("userData"));
  const settings = new SettingsStore(paths);
  const cipher: Cipher = safeStorage.isEncryptionAvailable()
    ? { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) }
    : plainCipher;
  const secrets = new SecretsStore(paths, cipher, managedKeys());
  const mcpStore = new McpServerStore(paths);
  const repo = new DashboardRepo(paths);
  // Dashboards created but never run (a build blocked before it started) are empty shells; drop them.
  for (const m of repo.list()) if (!m.hasHtml && repo.getChat(m.id).length === 0) repo.delete(m.id);
  const usage = new UsageLedger(paths.usage);
  const cloud = new CloudClient(
    cloudConfig(),
    {
      get: () => {
        try {
          const raw = secrets.get("cloud");
          return raw ? JSON.parse(raw) : undefined;
        } catch {
          return undefined;
        }
      },
      set: (sess) => (sess ? secrets.set("cloud", JSON.stringify(sess)) : secrets.clear("cloud")),
    },
    paths.cloudQueue,
    () => settings.get().installId,
    (m) => console.log("[cloud]", m)
  );
  // Every metered action goes to the server, which prices it and debits the balance.
  usage.onAppend((e) => cloud.recordUsage(e));
  setInterval(() => void cloud.flush(), 60_000);
  // The agent's keys arrive per session from the cloud (never in the bundle) and live in the encrypted store.
  cloud.onKeys((k) => {
    if (k) {
      secrets.set("openai", k.openai);
      secrets.set("composio", k.composio);
    } else {
      secrets.clear("openai");
      secrets.clear("composio");
    }
    composio.invalidate();
  });
  if (cloud.configured()) setTimeout(() => void cloud.fetchKeys(), 1500);
  const composio = new ComposioConnector(() => secrets.get("composio"), settings.get().installId);
  const libsDir = join(resourcesDir(), "libs");
  const brandDir = join(resourcesDir(), "brand");

  const mcpServers = async (): Promise<McpServerConfig[]> => {
    const list: McpServerConfig[] = [];
    if (composio.available()) {
      try {
        list.push(await composio.asMcpServer());
      } catch (e) {
        console.error("composio session", e);
      }
    }
    list.push(...mcpStore.enabled());
    return list;
  };

  const harness = new AgentHarness({
    repo,
    openaiKey: () => secrets.get("openai"),
    mcpServers,
    preview: new ElectronPreview(),
    homeDir: homedir(),
    log: (m) => console.log("[agent]", m),
  });

  const notify = (title: string, body: string, dashboardId: string) => {
    if (!settings.get().notifications || !Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on("click", () => {
      if (mainWindow) {
        showWindow(mainWindow);
        mainWindow.webContents.send("app:navigate", { to: "dashboard", id: dashboardId });
      }
    });
    n.show();
  };

  const scheduler = new Scheduler({
    repo,
    mcpServers,
    harness,
    refreshModel: () => settings.get().refreshModel,
    homeDir: homedir(),
    notify,
    log: (m) => console.log("[refresh]", m),
    onEvent: (dashboardId, event) => mainWindow?.webContents.send(IPC.agentEvent, { dashboardId, event }),
    usage,
  });

  const updater = new Updater((m) => console.log("[update]", m));
  updater.onChange((s) => mainWindow?.webContents.send(IPC.appUpdateChanged, s));
  ctx = { repo, settings, secrets, mcpStore, composio, scheduler, harness, usage, cloud, updater, libsDir, brandDir, localSources: discoverLocalSources };

  handleDashProtocol(repo, libsDir, brandDir);
  registerIpc(ctx);
  mainWindow = createWindow();
  createTray(ctx, () => mainWindow!, brandDir);
  scheduler.start();
  updater.start();
  powerMonitor.on("resume", () => void scheduler.tick("catchup"));

  const deepLink = async (url: string) => {
    if (!url.startsWith("mydashie://")) return;
    if (url.startsWith("mydashie://auth")) {
      const ok = await cloud.handleCallback(url);
      if (mainWindow) {
        showWindow(mainWindow);
        mainWindow.webContents.send(IPC.accountChanged, null);
        mainWindow.webContents.send("app:navigate", { to: ok ? "account" : "settings" });
      }
    }
  };
  cloud.onChange(() => mainWindow?.webContents.send(IPC.accountChanged, null));
  handleDeepLink = deepLink;
  if (pendingDeepLink) {
    void deepLink(pendingDeepLink);
    pendingDeepLink = null;
  }
  app.on("second-instance", (_e, argv) => {
    if (mainWindow) showWindow(mainWindow);
    const link = argv.find((a) => a.startsWith("mydashie://"));
    if (link) void deepLink(link);
  });
  app.on("activate", () => {
    if (mainWindow) showWindow(mainWindow);
    else mainWindow = createWindow();
  });
});

app.on("before-quit", () => {
  (app as typeof app & { isQuitting?: boolean }).isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
