import { GlyphArrowUp, Pic } from "../components/icons";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStore, toastRunError } from "../lib/store";
import { LiveMascot } from "../components/LiveMascot";
import { Button, Mascot, Textarea } from "../components/ui";
import type { ConnectionInfo } from "@shared/types";
import { formatCredits } from "@shared/pricing";
import { POWER } from "@shared/power";

/** One good starting prompt per app, shown for the apps the user has actually connected. */
const IDEAS_BY_APP: Record<string, string> = {
  stripe: "Stripe revenue this year: MRR by month, new vs churned customers, top plans",
  github: "GitHub: commits, open PRs and issues per repo for the last 30 days, and what's stuck",
  hubspot: "HubSpot pipeline by stage with deal value and win rate this quarter",
  googleanalytics: "Google Analytics traffic last 28 days: sessions, top pages, sources",
  google_analytics: "Google Analytics traffic last 28 days: sessions, top pages, sources",
  linear: "Linear: open issues by assignee and priority, cycle progress",
  jira: "Jira: open issues by status, priority and assignee, oldest first",
  gmail: "Gmail this week: who I'm emailing most, unanswered threads, reply times",
  googledrive: "Google Drive: files changed this week by owner and type",
  googlesheets: "Google Sheets: turn my tracking sheet into KPIs and trends",
  notion: "Notion: tasks by status and owner across my databases",
  slack: "Slack: message volume by channel and busiest hours this month",
  salesforce: "Salesforce: pipeline by stage, closing this month, top reps",
  shopify: "Shopify: orders and revenue by day, top products, repeat customers",
  linkedin: "LinkedIn: follower growth and post engagement",
  googlecalendar: "Google Calendar: meeting hours per week and who I meet most",
  granola: "Granola: meetings this week, decisions and open action items",
  airtable: "Airtable: records by status with weekly trend",
  quickbooks: "QuickBooks: revenue, expenses and cash by month this year",
};
const GENERIC_IDEAS = [
  "Read ~/Desktop/sales.csv and show revenue by region and month",
  "A weekly leadership summary across my connected apps",
  "Stripe revenue this year: MRR by month, new vs churned customers, top plans",
  "HubSpot pipeline by stage with deal value and win rate this quarter",
];

function ideasFor(connections: ConnectionInfo[]): string[] {
  const out: string[] = [];
  for (const c of connections) {
    const idea = IDEAS_BY_APP[c.toolkit.toLowerCase()] ?? `${c.name}: an overview of what matters this week`;
    if (!out.includes(idea)) out.push(idea);
  }
  for (const g of GENERIC_IDEAS) if (out.length < 6 && !out.includes(g)) out.push(g);
  return out.slice(0, 6);
}

export function NewDashboard() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const navigate = useStore((s) => s.navigate);
  const startRun = useStore((s) => s.startRun);

  useEffect(() => {
    window.dash.connections.list().then(setConnections).catch(() => {});
  }, []);

  // What this build should use, at the level Auto would pick for the prompt (big asks run on Max).
  const [estimate, setEstimate] = useState<{ level: keyof typeof POWER; low: number; high: number } | null>(null);
  useEffect(() => {
    const text = prompt.trim();
    if (!text) return setEstimate(null);
    const t = setTimeout(() => window.dash.agent.buildEstimate({ prompt: text }).then(setEstimate).catch(() => setEstimate(null)), 350);
    return () => clearTimeout(t);
  }, [prompt]);

  async function submit() {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      // Check credits and sign-in before creating anything, so a blocked build leaves no empty dashboard.
      const { blocked } = await window.dash.agent.preflight();
      if (blocked) throw new Error(blocked);
      const d = await window.dash.dashboards.create({ name: "New Dashboard", prompt: text });
      startRun(d.id);
      await window.dash.agent.run({ dashboardId: d.id, mode: "build", message: text });
      navigate({ name: "dashboard", id: d.id, openChat: true });
    } catch (e) {
      toastRunError(e, navigate);
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="drag h-10 shrink-0" />
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center px-8 pb-12">
        <LiveMascot mood="idle" size={140} interval={3200} />
        <h1 className="mt-1 text-center text-[26px] font-semibold tracking-tight">What do you want to see?</h1>
        <p className="mt-1.5 max-w-md text-center text-sm text-muted">Describe the dashboard in plain words. Mention the apps or files the data lives in and I'll take it from there.</p>

        <div className="card mt-7 w-full p-2 shadow-[0_18px_40px_-28px_rgba(124,108,246,0.5)]">
          <Textarea
            autoFocus
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            placeholder="e.g. A sales dashboard from HubSpot: pipeline by stage, deals closing this month, and top reps"
            className="border-0 bg-transparent px-3 py-2 text-[15px] focus:ring-0"
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              {connections.length ? (
                  <span className="flex items-center gap-1.5">
                    <span className="flex -space-x-1.5">
                      {connections.slice(0, 5).map((c) => (
                        <span key={c.toolkit} className="inline-flex size-5 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-surface-2" title={c.name}>
                          {c.logo ? <img src={c.logo} alt="" className="size-full object-cover" /> : <span className="text-[9px]">{c.name[0]}</span>}
                        </span>
                      ))}
                    </span>
                    {connections.length} app{connections.length === 1 ? "" : "s"} connected
                  </span>
                ) : (
                  <button className="flex items-center gap-1.5 hover:text-ink" onClick={() => navigate({ name: "settings", tab: "apps" })}>
                    <Pic name="apps" size={16} /> Connect apps for live data
                  </button>
                )}
            </div>
            <div className="flex items-center gap-3">
              {estimate && (
                <span className="text-[12px] tabular-nums text-muted" title={`Runs on ${POWER[estimate.level].label}. Builds vary with how much data and how many pages it takes.`}>
                  About {formatCredits(estimate.low)}{estimate.high > estimate.low ? `–${formatCredits(estimate.high)}` : ""} credits
                </span>
              )}
              <Button variant="primary" size="sm" onClick={() => void submit()} disabled={!prompt.trim()} loading={busy} className="pl-3.5">
                Build it <GlyphArrowUp size={16} />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 w-full">
          <div className="mb-2 text-[12px] font-medium text-muted">Try one of these</div>
          <div className="flex flex-wrap gap-2">
            {ideasFor(connections).map((idea) => (
              <button key={idea} onClick={() => setPrompt(idea)} className="pressable rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink">
                {idea}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
