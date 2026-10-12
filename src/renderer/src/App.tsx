import { useEffect } from "react";
import { useStore } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { Home } from "./views/Home";
import { NewDashboard } from "./views/NewDashboard";
import { DashboardView } from "./views/DashboardView";
import { SettingsView } from "./views/Settings";
import { WelcomeTour } from "./components/WelcomeTour";
import { SignInScreen } from "./components/SignIn";
import { toast } from "sonner";

export default function App() {
  const route = useStore((s) => s.route);
  const settings = useStore((s) => s.settings);
  const aboutOpen = useStore((s) => s.aboutOpen);
  const setAbout = useStore((s) => s.setAbout);
  const secrets = useStore((s) => s.secrets);
  const account = useStore((s) => s.account);
  const { refreshDashboards, loadSettings, loadAccount, applyEvent, navigate } = useStore();

  useEffect(() => {
    void refreshDashboards();
    void loadSettings();
    void loadAccount();
    const offAccount = window.dash.account.onChanged(() => {
      void loadAccount();
      void loadSettings();
    });
    // A new version: one calm toast with a download button; never nags more than once per version.
    let announced = "";
    const offUpdate = window.dash.app.onUpdate((s) => {
      if ((s.state === "available" || s.state === "ready") && s.version && s.version !== announced) {
        announced = s.version;
        toast(`MyDashie ${s.version} is available`, {
          description: s.state === "ready" ? "Restart to finish updating." : "Download the new version from the site and drag it over the old one.",
          action: { label: s.state === "ready" ? "Restart" : "Download", onClick: () => void window.dash.app.installUpdate() },
          duration: 15000,
        });
      }
    });
    const offChanged = window.dash.dashboards.onChanged(() => void refreshDashboards());
    const offEvents = window.dash.agent.onEvent(({ dashboardId, event }) => applyEvent(dashboardId, event));
    const offNav = window.dash.app.onNavigate((p) => {
      if (p.to === "dashboard" && p.id) navigate({ name: "dashboard", id: p.id });
      if (p.to === "account") navigate({ name: "settings", tab: "account" });
      if (p.to === "settings") navigate({ name: "settings" });
    });
    return () => {
      offChanged();
      offEvents();
      offNav();
      offAccount();
      offUpdate();
    };
  }, [refreshDashboards, loadSettings, loadAccount, applyEvent, navigate]);

  // theme
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const pref = settings?.theme ?? "system";
      const dark = pref === "dark" || (pref === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      useStore.setState({ theme: dark ? "dark" : "light" });
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings?.theme]);

  if (!settings) return <div className="h-full" />;
  // Cloud builds: an account comes before anything else, so nobody lands in an app that can't run.
  if (account === null) return <div className="h-full" />;
  if (account.configured && !account.signedIn) return <SignInScreen acct={account} />;
  if (!settings.onboarded)
    return (
      <WelcomeTour
        variant="first-run"
        onDone={async (build) => {
          await window.dash.settings.set({ onboarded: true });
          await loadSettings();
          navigate(build ? { name: "new" } : { name: "home" });
        }}
      />
    );

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {route.name === "home" && <Home />}
        {route.name === "new" && <NewDashboard />}
        {route.name === "dashboard" && <DashboardView key={route.id} id={route.id} openChat={route.openChat} />}
        {route.name === "settings" && <SettingsView tab={route.tab} />}
      </main>
      {aboutOpen && <WelcomeTour variant="about" onDone={(build) => { setAbout(false); if (build) navigate({ name: "new" }); }} />}
    </div>
  );
}
