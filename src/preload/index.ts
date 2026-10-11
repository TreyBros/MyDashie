import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";

const invoke = (channel: string) => (arg?: unknown) => ipcRenderer.invoke(channel, arg);

const api = {
  dashboards: {
    list: invoke(IPC.dashboardsList),
    get: invoke(IPC.dashboardGet),
    create: invoke(IPC.dashboardCreate),
    update: invoke(IPC.dashboardUpdate),
    delete: invoke(IPC.dashboardDelete),
    chat: invoke(IPC.dashboardChat),
    data: invoke(IPC.dashboardData),
    html: invoke(IPC.dashboardHtml),
    export: invoke(IPC.dashboardExport),
    openInBrowser: invoke(IPC.dashboardOpenInBrowser),
    refresh: invoke(IPC.dashboardRefresh),
    refreshLog: invoke(IPC.dashboardRefreshLog),
    reveal: invoke(IPC.dashboardReveal),
    versions: invoke(IPC.dashboardVersions),
    restore: invoke(IPC.dashboardRestore),
    onChanged: (cb: () => void) => {
      const l = () => cb();
      ipcRenderer.on(IPC.dashboardsChanged, l);
      return () => ipcRenderer.removeListener(IPC.dashboardsChanged, l);
    },
  },
  agent: {
    run: invoke(IPC.agentRun),
    cancel: invoke(IPC.agentCancel),
    answer: invoke(IPC.agentAnswer),
    onEvent: (cb: (payload: unknown) => void) => {
      const l = (_e: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on(IPC.agentEvent, l);
      return () => ipcRenderer.removeListener(IPC.agentEvent, l);
    },
  },
  settings: { get: invoke(IPC.settingsGet), set: invoke(IPC.settingsSet) },
  secrets: { status: invoke(IPC.secretsStatus), set: invoke(IPC.secretsSet), clear: invoke(IPC.secretsClear) },
  models: { list: invoke(IPC.modelsList) },
  connections: {
    list: invoke(IPC.connectionsList),
    search: invoke(IPC.connectionsSearchToolkits),
    connect: invoke(IPC.connectionsConnect),
    disconnect: invoke(IPC.connectionsDisconnect),
  },
  mcp: { list: invoke(IPC.mcpList), add: invoke(IPC.mcpAdd), update: invoke(IPC.mcpUpdate), remove: invoke(IPC.mcpRemove), test: invoke(IPC.mcpTest) },
  local: { sources: invoke(IPC.localSources) },
  usage: { summary: invoke(IPC.usageSummary), export: invoke(IPC.usageExport) },
  account: {
    status: invoke(IPC.accountStatus),
    signIn: invoke(IPC.accountSignIn),
    signOut: invoke(IPC.accountSignOut),
    magicLink: invoke(IPC.accountMagicLink),
    verifyCode: invoke(IPC.accountVerifyCode),
    cancelLogin: invoke(IPC.accountCancelLogin),
    checkout: invoke(IPC.accountCheckout),
    portal: invoke(IPC.accountPortal),
    onChanged: (cb: () => void) => {
      const l = () => cb();
      ipcRenderer.on(IPC.accountChanged, l);
      return () => ipcRenderer.removeListener(IPC.accountChanged, l);
    },
  },
  app: {
    version: invoke(IPC.appVersion),
    updateStatus: invoke(IPC.appUpdateStatus),
    checkForUpdates: invoke(IPC.appUpdateCheck),
    installUpdate: invoke(IPC.appUpdateInstall),
    onUpdate: (cb: (s: unknown) => void) => {
      const l = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on(IPC.appUpdateChanged, l);
      return () => ipcRenderer.removeListener(IPC.appUpdateChanged, l);
    },
    openExternal: invoke(IPC.appOpenExternal),
    pickFile: invoke(IPC.appPickFile),
    onNavigate: (cb: (payload: { to: string; id?: string }) => void) => {
      const l = (_e: unknown, payload: { to: string; id?: string }) => cb(payload);
      ipcRenderer.on("app:navigate", l);
      return () => ipcRenderer.removeListener("app:navigate", l);
    },
    platform: process.platform,
  },
};

contextBridge.exposeInMainWorld("dash", api);
export type DashApi = typeof api;
