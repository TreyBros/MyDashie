// IPC channel names. Keep in sync with src/preload/index.ts and src/main/ipc.ts.
export const IPC = {
  // dashboards
  dashboardsList: "dashboards:list",
  dashboardGet: "dashboards:get",
  dashboardCreate: "dashboards:create",
  dashboardUpdate: "dashboards:update",
  dashboardDelete: "dashboards:delete",
  dashboardChat: "dashboards:chat",
  dashboardData: "dashboards:data",
  dashboardHtml: "dashboards:html",
  dashboardExport: "dashboards:export",
  dashboardOpenInBrowser: "dashboards:open-in-browser",
  dashboardRefresh: "dashboards:refresh",
  dashboardRefreshLog: "dashboards:refresh-log",
  dashboardReveal: "dashboards:reveal",
  dashboardVersions: "dashboards:versions",
  dashboardRestore: "dashboards:restore",
  // agent
  agentRun: "agent:run",
  agentCancel: "agent:cancel",
  agentPreflight: "agent:preflight",
  agentBuildEstimate: "agent:build-estimate",
  agentAnswer: "agent:answer",
  agentEvent: "agent:event", // main -> renderer
  // settings & secrets
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  secretsStatus: "secrets:status",
  secretsSet: "secrets:set",
  secretsClear: "secrets:clear",
  modelsList: "models:list",
  // connections
  connectionsList: "connections:list",
  connectionsConnect: "connections:connect",
  connectionsDisconnect: "connections:disconnect",
  connectionsSearchToolkits: "connections:search-toolkits",
  mcpList: "mcp:list",
  mcpAdd: "mcp:add",
  mcpUpdate: "mcp:update",
  mcpRemove: "mcp:remove",
  mcpTest: "mcp:test",
  localSources: "local:sources",
  // usage (credits)
  usageSummary: "usage:summary",
  usageExport: "usage:export",
  // account (cloud)
  accountStatus: "account:status",
  accountSignIn: "account:sign-in",
  accountSignOut: "account:sign-out",
  accountMagicLink: "account:magic-link",
  accountVerifyCode: "account:verify-code",
  accountCancelLogin: "account:cancel-login",
  accountCheckout: "account:checkout",
  accountPortal: "account:portal",
  accountOpenWeb: "account:open-web",
  accountChanged: "account:changed", // main -> renderer
  // app
  appVersion: "app:version",
  appUpdateStatus: "app:update-status",
  appUpdateCheck: "app:update-check",
  appUpdateInstall: "app:update-install",
  appUpdateChanged: "app:update-changed", // main -> renderer
  appOpenExternal: "app:open-external",
  appPickFile: "app:pick-file",
  dashboardsChanged: "dashboards:changed", // main -> renderer
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
