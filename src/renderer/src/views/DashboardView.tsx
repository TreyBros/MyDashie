import { useCallback, useEffect, useRef, useState } from "react";
import { RenameField } from "../components/RenameField";
import { clsx } from "clsx";
import { GlyphArrowUp, GlyphCheck, GlyphChevron, GlyphClose, GlyphPlus, Pic, Spinner, TopicIcon } from "../components/icons";

import { toast } from "sonner";
import { useStore, relativeTime, type ActivityItem, friendlyError, toastRunError } from "../lib/store";
import { LiveMascot, BUILD_CAPTIONS } from "../components/LiveMascot";
import { WorkCard } from "../components/WorkCard";
import { DashFrame } from "../components/DashFrame";
import { BuildStrip } from "../components/BuildStrip";
import { RefreshHistory } from "../components/RefreshHistory";
import { ScheduleDialog, scheduleLabel } from "../components/ScheduleDialog";
import { stageOf } from "@shared/stages";
import type { ActivityStep } from "@shared/types";
import { Button, Chip, IconButton, Mascot, Textarea } from "../components/ui";
import { statusChip } from "./Home";
import type { CardSelection, ChatMessage, DashboardManifest, Schedule } from "@shared/types";
import { POWER, POWER_LEVELS, type PowerChoice } from "@shared/power";

export function DashboardView({ id, openChat }: { id: string; openChat?: boolean }) {
  const d = useStore((s) => s.dashboards.find((x) => x.id === id));
  const run = useStore((s) => s.runs[id]);
  const theme = useStore((s) => s.theme);
  const navigate = useStore((s) => s.navigate);
  const [chatOpen, setChatOpen] = useState(!!openChat);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [picking, setPicking] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const onSelected = useCallback((sel: Selection) => {
    setSelection(sel);
    setPicking(false);
    setChatOpen(true);
  }, []);
  const onSelectCancel = useCallback(() => setPicking(false), []);
  const togglePick = () => {
    const next = !picking;
    setPicking(next);
    frameRef.current?.contentWindow?.postMessage({ type: "dash-select-mode", on: next }, "*");
  };

  useEffect(() => {
    if (run?.running) setChatOpen(true);
  }, [run?.running]);

  if (!d) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        This dashboard was removed. <button className="ml-1 underline" onClick={() => navigate({ name: "home" })}>Go home</button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <Header d={d} chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />
        <div className="relative m-3 mt-0 flex-1 overflow-hidden rounded-2xl border border-line bg-surface">
          {d.hasHtml ? (
            <DashFrame d={d} theme={theme} frameRef={frameRef} onSelected={onSelected} onSelectCancel={onSelectCancel} />
          ) : (
            <BuildingState d={d} running={!!run?.running} step={[...(run?.items ?? [])].reverse().find((x) => x.kind === "tool")?.label} link={!run?.running ? [...(run?.items ?? [])].reverse().find((x) => x.kind === "link") : undefined} onOpenChat={() => setChatOpen(true)} />
          )}
          {/* The progress strip only matters when the chat (which shows the same progress) is hidden. */}
          {d.hasHtml && run?.running && !run.question && !chatOpen && <BuildStrip items={run.items} plan={run.plan} mode={d.status === "building" ? "build" : "edit"} startedAt={run.startedAt} />}
          {d.hasHtml && d.status === "refreshing" && (
            <div className="pop-in pointer-events-none absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-line bg-surface/95 py-1 pl-1 pr-4 shadow-[0_12px_30px_-16px_rgba(28,27,40,0.45)] backdrop-blur">
              <LiveMascot mood="refreshing" size={44} interval={1800} />
              <span className="text-[13px] font-medium text-ink">Refreshing your data…</span>
            </div>
          )}
          {d.status === "stale" && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-peach-soft/95 px-3 py-1.5 text-[12.5px] text-[#8a4a12] backdrop-blur dark:text-[#ffc89c]">
              <Pic name="alert" size={14} /> Showing data from {relativeTime(d.staleSince ?? d.dataFetchedAt)}. {d.lastError ? `Last refresh failed: ${d.lastError.slice(0, 120)}` : "Refresh failed."}
            </div>
          )}
        </div>
      </div>
      {chatOpen && <ChatPanel d={d} onClose={() => setChatOpen(false)} picking={picking} onTogglePick={d.hasHtml ? togglePick : undefined} selection={selection} onClearSelection={() => setSelection(null)} />}
    </div>
  );
}

function Header({ d, chatOpen, onToggleChat }: { d: DashboardManifest; chatOpen: boolean; onToggleChat: () => void }) {
  const [menu, setMenu] = useState(false);
  const [sched, setSched] = useState(false);
  const [history, setHistory] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const navigate = useStore((s) => s.navigate);
  const busy = d.status === "refreshing" || d.status === "building";

  return (
    <header className="@container drag flex items-center gap-3 px-5 pt-10 pb-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
      <TopicIcon topic={d.icon} size={28} />
      {renaming ? (
        <RenameField id={d.id} name={d.name} onDone={() => setRenaming(false)} className="h-9 w-[min(420px,100%)] text-[18px] font-semibold tracking-tight" />
      ) : (
        <button
          onClick={() => setRenaming(true)}
          className="no-drag group -mx-2 flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-surface-2"
          title="Rename"
          aria-label={`Rename ${d.name}`}
        >
          <span className="truncate text-[18px] font-semibold tracking-tight">{d.name}</span>
          <Pic name="edit" size={16} className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-80 group-focus-visible:opacity-80" />
        </button>
      )}
      <div className="no-drag hidden shrink-0 @[760px]:block">{statusChip(d)}</div>
      <span className="hidden whitespace-nowrap text-[12px] text-muted @[1000px]:inline">Updated {relativeTime(d.dataFetchedAt)}</span>
      </div>

      <div className="no-drag flex shrink-0 items-center gap-1.5">
        <div className="relative">
          <Button size="sm" onClick={() => setSched(true)} className={clsx("gap-1.5", d.schedule.kind !== "off" && "border-mint/50")} title={`Refresh schedule: ${scheduleLabel(d.schedule)}`}>
            <Pic name="schedule" size={16} /> <span className="hidden @[640px]:inline">{d.schedule.kind === "off" ? "Schedule" : scheduleLabel(d.schedule)}</span> <GlyphChevron size={14} className="text-muted" />
          </Button>
          {sched && <ScheduleDialog d={d} onClose={() => setSched(false)} />}
          {history && <RefreshHistory d={d} onClose={() => setHistory(false)} />}
        </div>
        <Button size="sm" disabled={busy || !d.hasHtml} onClick={() => void window.dash.dashboards.refresh(d.id)} className="gap-1.5" title="Refresh now">
          <Pic name="refresh" size={16} spin={d.status === "refreshing"} /> <span className="hidden @[860px]:inline">Refresh</span>
        </Button>
        <Button size="sm" variant={chatOpen ? "soft" : "primary"} onClick={onToggleChat} className="gap-1.5" title={chatOpen ? "Hide Dashie" : "Talk to Dashie"}>
          <Pic name="ai" size={18} /> <span className="hidden @[540px]:inline">{chatOpen ? "Hide" : "Talk to Dashie"}</span>
        </Button>
        <div className="relative">
          <IconButton label="More" onClick={() => setMenu((v) => !v)}>
            <Pic name="more" size={18} />
          </IconButton>
          {menu && (
            <Menu onClose={() => setMenu(false)}>
              <MenuItem icon={<Pic name="edit" size={18} />} onClick={() => setRenaming(true)}>
                Rename
              </MenuItem>
              <MenuItem icon={<Pic name="export" size={18} />} disabled={!d.hasHtml} onClick={async () => { const p = await window.dash.dashboards.export(d.id); if (p) toast.success("Saved HTML file"); }}>
                Save as HTML…
              </MenuItem>
              <MenuItem icon={<Pic name="browser" size={18} />} disabled={!d.hasHtml} onClick={() => void window.dash.dashboards.openInBrowser(d.id)}>
                Open in browser
              </MenuItem>
              <MenuItem icon={<Pic name="schedule" size={18} />} disabled={!d.hasHtml} onClick={() => setHistory(true)}>
                Refresh history
              </MenuItem>
              <MenuItem icon={<Pic name="folder" size={18} />} onClick={() => void window.dash.dashboards.reveal(d.id)}>
                Show files in Finder
              </MenuItem>
              <div className="my-1 border-t border-line" />
              <MenuItem
                icon={<Pic name="trash" size={18} />}
                danger
                onClick={async () => {
                  await window.dash.dashboards.delete(d.id);
                  navigate({ name: "home" });
                }}
              >
                Delete dashboard
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>
    </header>
  );
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="pop-in absolute right-0 z-20 mt-1 w-56 rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_40px_-20px_rgba(28,27,40,0.4)]" onClick={onClose}>
        {children}
      </div>
    </>
  );
}

function MenuItem({ icon, children, onClick, danger, disabled }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={clsx("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] disabled:opacity-40", danger ? "text-danger hover:bg-rose-soft" : "text-ink hover:bg-surface-2")}
    >
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}

function BuildingState({ d, running, link, step, onOpenChat }: { d: DashboardManifest; running: boolean; link?: ActivityItem; step?: string; onOpenChat: () => void }) {
  if (link) {
    const app = link.text.replace(/^Connect /, "") || "your app";
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <LiveMascot mood="connecting" size={190} />
        <div className="mt-2 text-[17px] font-semibold">Connect {app} to continue</div>
        <p className="mt-1 max-w-sm text-sm text-muted">Dashie needs read access to {app} to build this dashboard. It opens in your browser and takes a few seconds.</p>
        <ConnectActions d={d} link={link} />
      </div>
    );
  }
  return <BuildingBody d={d} running={running} step={step} onOpenChat={onOpenChat} />;
}

function BuildingBody({ d, running, step, onOpenChat }: { d: DashboardManifest; running: boolean; step?: string; onOpenChat: () => void }) {
  const [scene, setScene] = useState("");
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <LiveMascot mood={running ? "building" : d.status === "error" ? "trouble" : "idle"} size={200} interval={running ? 2400 : 3200} onScene={setScene} />
      <div className="mt-2 text-[17px] font-semibold">{running ? "Dashie is building your dashboard" : d.status === "error" ? "That build didn't finish" : "Nothing built yet"}</div>
      {running && (step || BUILD_CAPTIONS[scene]) ? (
        <p key={step ?? scene} className="caption-in mt-1 text-sm font-medium text-lilac dark:text-[#c9c0ff]">{step ?? BUILD_CAPTIONS[scene]}…</p>
      ) : (
        <p className="mt-1 max-w-sm text-sm text-muted">
          {running ? "Pulling data, shaping it, and writing the page." : d.status === "error" ? d.lastError ?? "Open the AI panel to see what happened and try again." : "Open the AI panel and tell Dashie what to build."}
        </p>
      )}
      {!running && (
        <Button variant="primary" className="mt-5" onClick={onOpenChat}>
          <Pic name="ai" size={18} /> Open AI panel
        </Button>
      )}
    </div>
  );
}

// ---------------- chat / activity panel ----------------

interface Selection {
  id: string;
  title: string;
  kind: string;
  page?: string;
}

function ChatPanel({ d, onClose, picking, onTogglePick, selection, onClearSelection }: { d: DashboardManifest; onClose: () => void; picking?: boolean; onTogglePick?: () => void; selection?: Selection | null; onClearSelection?: () => void }) {
  const run = useStore((s) => s.runs[d.id]);
  const startRun = useStore((s) => s.startRun);
  const clearRun = useStore((s) => s.clearRun);
  const navigate = useStore((s) => s.navigate);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.dash.dashboards.chat(d.id).then(setHistory).catch(() => {});
  }, [d.id, run?.running]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [run?.items.length, run?.streaming, history.length]);

  const settingsPower = useStore((s) => s.settings?.power ?? "auto");
  const [power, setPower] = useState<PowerChoice>(settingsPower);
  useEffect(() => setPower(settingsPower), [settingsPower]);

  /** Sends a message. The picked card travels as data (shown as a chip), never as text in the bubble. */
  async function send(override?: string, opts: { intent?: "ask" | "change"; refundLast?: boolean; selection?: CardSelection | null } = {}) {
    const msg = (override ?? text).trim();
    if (!msg || run?.running) return;
    // Out of credits or signed out: say so and keep the message in the box instead of starting a run.
    const { blocked } = await window.dash.agent.preflight().catch(() => ({ blocked: null }));
    if (blocked) return toastRunError(new Error(blocked), navigate);
    setText("");
    startRun(d.id);
    const sel = opts.selection === null ? undefined : (opts.selection ?? selection ?? undefined);
    setHistory((h) => [...h, { role: "user", content: msg, at: new Date().toISOString(), selection: sel, intent: opts.intent }]);
    try {
      onClearSelection?.();
      await window.dash.agent.run({ dashboardId: d.id, mode: d.hasHtml ? "edit" : "build", message: msg, selection: sel, intent: opts.intent, power, refundLast: opts.refundLast });
    } catch (e) {
      clearRun(d.id);
      toastRunError(e, navigate);
    }
  }

  const items = run?.items ?? [];
  const live = !!run?.running;
  const links = items.filter((x) => x.kind === "link");
  const liveSteps = toSteps(items);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface-2/50">
      <div className="drag flex items-center justify-between px-4 pt-10 pb-2">
        <div className="flex items-center gap-2">
          <img src="dash://brand/dashy.png" width={22} height={22} alt="" />
          <span className="text-sm font-semibold">Dashie</span>
        </div>
        <div className="no-drag">
          <IconButton label="Close" onClick={onClose}><GlyphClose size={16} /></IconButton>
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 pb-3">
        {history.length === 0 && !live && (
          <div className="rounded-2xl bg-surface p-3 text-[13px] text-ink-2">
            Ask for changes in plain words: "make the revenue chart a line", "add a table of top customers", "use a dark theme", "pull the last 90 days instead".
          </div>
        )}
        {history.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="space-y-1">
              <Bubble role="user" text={m.content} />
              <MessageChips
                selection={m.selection}
                intent={i === history.length - 1 && live ? (run?.intent ?? m.intent) : m.intent}
                canReroute={i === history.length - 2 && !live && !!d.hasHtml}
                onReroute={(intent) => void send(m.content, { intent, refundLast: true, selection: m.selection ?? null })}
              />
            </div>
          ) : (
            <div key={i} className="space-y-2">
              {m.activity && m.activity.steps.length > 0 && (
                <WorkCard steps={m.activity.steps} startedAt={m.activity.startedAt} endedAt={m.activity.endedAt} live={false} ok={m.activity.ok} mode={m.activity.mode} level={m.activity.level} plan={m.activity.plan} credits={m.activity.credits} waitingOnUser={m.activity.needsConnection && i === history.length - 1} />
              )}
              {m.content && <Bubble role="assistant" text={m.content} />}
              {i === history.length - 1 && !live && m.activity?.mode === "ask" && /want me to change it\?\s*$/i.test(m.content) && history[i - 1]?.role === "user" && (
                <div className="pl-1">
                  <button onClick={() => void send(history[i - 1]!.content, { intent: "change", selection: history[i - 1]!.selection ?? null })} className="pressable rounded-full border border-lilac/25 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:border-lilac/50 hover:text-ink">
                    Yes, change it
                  </button>
                </div>
              )}
              {i === history.length - 1 && !live && (
                <AfterRun
                  d={d}
                  suggestions={m.activity?.suggestions}
                  versionBefore={m.activity?.mode === "edit" ? m.activity?.versionBefore : undefined}
                  onSuggest={(t) => void send(t)}
                  onRestored={() => window.dash.dashboards.chat(d.id).then(setHistory)}
                />
              )}
            </div>
          )
        )}
        {live && (
          <WorkCard
            steps={liveSteps}
            startedAt={run!.startedAt}
            live
            mode={run!.intent === "ask" ? "ask" : d.hasHtml ? "edit" : "build"}
            level={run!.level}
            waitingOnUser={run!.question ? "question" : links.length > 0}
            plan={run!.plan}
            onStop={() => void window.dash.agent.cancel(d.id)}
          />
        )}
        {live && run!.question && <QuestionCard key={run!.question.requestId} q={run!.question} />}
        {links.map((it) => (
          <Activity key={it.id} item={it} dash={d} />
        ))}
      </div>

      <div className="border-t border-line p-3">
        {(selection || onTogglePick || d.hasHtml) && (
          <div className="mb-2 flex items-center gap-2">
            <PowerPill value={power} onChange={setPower} />
            {selection ? (
              <span className="pop-in inline-flex max-w-full items-center gap-1.5 rounded-full bg-lilac-soft py-1 pl-3 pr-1 text-[12.5px] font-semibold text-lilac dark:text-[#c9c0ff]">
                <span className="truncate">Editing: {selection.title || selection.kind}</span>
                <button aria-label="Clear selection" onClick={onClearSelection} className="flex size-5 items-center justify-center rounded-full hover:bg-white/60">
                  <GlyphClose size={11} />
                </button>
              </span>
            ) : (
              onTogglePick && (
                <button
                  onClick={onTogglePick}
                  className={clsx("pressable inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold", picking ? "border-lilac bg-lilac text-white" : "border-line text-ink-2 hover:border-lilac/40")}
                >
                  <GlyphPlus size={12} className={clsx(picking && "rotate-45 transition-transform")} />
                  {picking ? "Click a card on the dashboard…" : "Pick a card to change"}
                </button>
              )
            )}
          </div>
        )}
        <div className="card flex items-end gap-2 p-1.5">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={d.hasHtml ? "Ask or change anything…" : "Describe the dashboard…"}
            className="border-0 bg-transparent px-2.5 py-1.5 text-[13.5px] focus:ring-0"
          />
          {run?.running ? (
            <IconButton label="Stop" onClick={() => void window.dash.agent.cancel(d.id)} className="mb-0.5 bg-surface-2">
              <Pic name="stop" size={14} />
            </IconButton>
          ) : (
            <IconButton label="Send" onClick={() => void send()} disabled={!text.trim()} className="mb-0.5 bg-lilac text-white hover:bg-lilac">
              <GlyphArrowUp size={16} />
            </IconButton>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Under a user bubble: the card it was about, and how Dashie read it (with a one-tap re-route). */
function MessageChips({ selection, intent, canReroute, onReroute }: { selection?: CardSelection; intent?: "ask" | "change"; canReroute: boolean; onReroute: (intent: "ask" | "change") => void }) {
  if (!selection && !intent) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 pr-1 text-[11.5px]">
      {selection && (
        <span className="inline-flex items-center gap-1 rounded-full bg-lilac-soft px-2 py-0.5 font-medium text-lilac dark:text-[#c9c0ff]" title={selection.page ? `On the ${selection.page} page` : undefined}>
          <Pic name="edit" size={11} /> {selection.title || selection.kind}
        </span>
      )}
      {intent && (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-medium text-muted">
          {intent === "ask" ? "Question" : "Change"}
          {canReroute && (
            <button onClick={() => onReroute(intent === "ask" ? "change" : "ask")} className="ml-0.5 text-lilac hover:underline dark:text-[#c9c0ff]" title={intent === "ask" ? "Dashie read this as a question. Run it as a change instead (credits refunded)." : "Dashie read this as a change. Just answer instead (credits refunded)."}>
              {intent === "ask" ? "change it instead" : "just answer"}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Auto · Quick · Smart · Max, per dashboard. Never a model name. */
function PowerPill({ value, onChange }: { value: PowerChoice; onChange: (p: PowerChoice) => void }) {
  const [open, setOpen] = useState(false);
  const label = value === "auto" ? "Auto" : POWER[value].label;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className={clsx("pressable inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold", value === "auto" ? "border-line text-muted hover:text-ink" : "border-lilac/40 text-lilac dark:text-[#c9c0ff]")} title="Power level">
        {label} <GlyphChevron size={11} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="pop-in absolute bottom-full left-0 z-20 mb-1 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_40px_-20px_rgba(28,27,40,0.4)]">
            {(["auto", ...POWER_LEVELS] as PowerChoice[]).map((p) => (
              <button key={p} onClick={() => { onChange(p); setOpen(false); }} className={clsx("flex w-full flex-col rounded-xl px-3 py-2 text-left hover:bg-surface-2", value === p && "bg-lilac-soft/60")}>
                <span className="flex w-full items-baseline justify-between text-[13px] font-semibold text-ink">
                  {p === "auto" ? "Auto" : POWER[p].label}
                  {p !== "auto" && <span className="text-[11px] font-normal text-muted">{POWER[p].multiplier}× credits</span>}
                </span>
                <span className="text-[11.5px] leading-snug text-muted">{p === "auto" ? "Dashie picks per request." : POWER[p].blurb}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Bubble({ role, text, streaming }: { role: "user" | "assistant"; text: string; streaming?: boolean }) {
  return (
    <div className={clsx("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div className={clsx("max-w-[92%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed selectable", role === "user" ? "bg-lilac text-white rounded-br-md" : "bg-surface text-ink rounded-bl-md border border-line")}>
        {role === "assistant" ? <RichText text={text} /> : text}
        {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded bg-lilac align-middle" />}
      </div>
    </div>
  );
}

function Activity({ item, dash }: { item: ActivityItem; dash: DashboardManifest }) {
  if (item.kind === "text") return <Bubble role="assistant" text={item.text} />;
  if (item.kind === "status") return <div className="px-1 text-[12px] text-muted">{item.text}</div>;
  if (item.kind === "link")
    return (
      <div className="rounded-2xl border border-lilac/30 bg-lilac-soft/60 p-3">
        <div className="mb-2 text-[13px] text-ink">{item.text.replace(/^Connect /, "") ? `Dashie needs access to ${item.text.replace(/^Connect /, "")} to continue.` : "Dashie needs access to continue."} It opens in your browser and takes a few seconds.</div>
        <div className="mb-2 text-[11.5px] text-muted">Secure connection powered by Composio. Read-only access.</div>
        <ConnectActions d={dash} link={item} compact />
      </div>
    );
  if (item.kind === "done")
    return (
      <div className={clsx("flex items-center gap-2 px-1 text-[12px]", item.ok ? "text-muted" : "text-danger")}>
        {item.ok ? <GlyphCheck size={14} /> : <Pic name="alert" size={14} />} {item.text}
      </div>
    );
  // tool
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2">
      <div className="flex items-start gap-2 text-[12.5px]">
        {item.running ? <Spinner size={14} className="mt-0.5 text-lilac" /> : item.ok ? <GlyphCheck size={14} className="mt-0.5 text-mint" /> : <Pic name="refresh" size={14} className="mt-0.5 opacity-70" />}
        <span className="font-medium text-ink break-words [overflow-wrap:anywhere]">{item.label}</span>
      </div>
      {!item.running && item.text && item.text !== item.label && (
        <div className="mt-1 line-clamp-2 pl-5.5 text-[11.5px] text-muted selectable" title={item.ok ? undefined : item.text}>
          {item.ok ? item.text : "Hit a snag, trying another way"}
        </div>
      )}
      {item.screenshot && <img src={`data:image/png;base64,${item.screenshot}`} alt="Preview" className="mt-2 w-full rounded-xl border border-line" />}
    </div>
  );
}

/** Minimal formatting for assistant text: **bold**, [label](url) as a button, bare URLs hidden behind "Open link". */
function RichText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/\S+)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] || m[3]) {
      const url = (m[2] ?? m[3])!.replace(/[.,)]+$/, "");
      const label = m[1] ?? "Open link";
      parts.push(
        <button key={k++} onClick={() => void window.dash.app.openExternal(url)} className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-lilac-soft px-2.5 py-0.5 align-baseline text-[12.5px] font-medium text-lilac hover:brightness-95 dark:text-[#c9c0ff]">
          <Pic name="link" size={12} /> {label}
        </button>
      );
    } else if (m[4]) parts.push(<strong key={k++}>{m[4]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Open the connect page, then offer a one-click "continue" that resumes the build. */
function ConnectActions({ d, link, compact }: { d: DashboardManifest; link: ActivityItem; compact?: boolean }) {
  const [opened, setOpened] = useState(false);
  const run = useStore((s) => s.runs[d.id]);
  const startRun = useStore((s) => s.startRun);
  const app = link.text.replace(/^Connect /, "") || "the app";
  const resume = async () => {
    startRun(d.id);
    await window.dash.agent.run({ dashboardId: d.id, mode: d.hasHtml ? "edit" : "build", message: `I connected ${app}. Please continue building the dashboard.` });
  };
  return (
    <div className={clsx("flex flex-wrap items-center gap-2", !compact && "mt-5 justify-center")}>
      <Button variant={opened ? "secondary" : "primary"} size={compact ? "sm" : "md"} onClick={() => { if (link.url) void window.dash.app.openExternal(link.url); setOpened(true); }}>
        <Pic name="link" size={16} /> {link.text}
      </Button>
      {opened && (
        <Button variant="primary" size={compact ? "sm" : "md"} disabled={run?.running} onClick={() => void resume()}>
          <GlyphCheck size={14} /> I've connected, continue
        </Button>
      )}
    </div>
  );
}

/** Live run items → the same step shape the main process persists. */
function toSteps(items: ActivityItem[]): ActivityStep[] {
  const out: ActivityStep[] = [];
  for (const it of items) {
    if (it.kind === "tool") {
      out.push({ id: it.id, kind: "tool", tool: it.tool, label: it.label ?? "Working", summary: it.running ? undefined : it.ok ? it.text : "Hit a snag, trying another way", ok: it.ok, stage: stageOf(it.tool), startedAt: it.startedAt ?? it.at, endedAt: it.running ? undefined : it.at });
    } else if (it.kind === "text") {
      const last = out[out.length - 1];
      out.push({ id: it.id, kind: "note", label: it.text, stage: last?.stage ?? "plan", startedAt: it.at, endedAt: it.at });
    }
  }
  return out;
}

/** Follow-up idea chips and one-click undo under Dashie's latest reply. */
function AfterRun({ d, suggestions, versionBefore, onSuggest, onRestored }: { d: DashboardManifest; suggestions?: string[]; versionBefore?: string; onSuggest: (t: string) => void; onRestored: () => void }) {
  const [undone, setUndone] = useState(false);
  if (!suggestions?.length && !versionBefore) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-1">
      {suggestions?.map((s) => (
        <button
          key={s}
          onClick={() => onSuggest(s)}
          className="pressable rounded-full border border-lilac/25 bg-surface px-3 py-1.5 text-left text-[12.5px] font-medium text-ink-2 hover:border-lilac/50 hover:text-ink"
        >
          {s}
        </button>
      ))}
      {versionBefore && (
        <button
          disabled={undone}
          onClick={async () => {
            await window.dash.dashboards.restore({ id: d.id, version: versionBefore });
            setUndone(true);
            toast.success("Change undone");
            onRestored();
          }}
          className="pressable ml-auto rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          {undone ? "Undone" : "Undo this change"}
        </button>
      )}
    </div>
  );
}

/** Dashie's questions: tappable options, multi-select where it fits, and a free-text answer. */
function QuestionCard({ q }: { q: { requestId: string; intro?: string; questions: { id: string; question: string; options: string[]; multi?: boolean }[] } }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const toggle = (id: string, opt: string, multi?: boolean) =>
    setPicked((p) => {
      const cur = p[id] ?? [];
      if (!multi) return { ...p, [id]: cur[0] === opt ? [] : [opt] };
      return { ...p, [id]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });
  const submit = async () => {
    setSending(true);
    const answers: Record<string, string[]> = {};
    for (const qq of q.questions) {
      const o = (other[qq.id] ?? "").trim();
      answers[qq.id] = [...(picked[qq.id] ?? []), ...(o ? [o] : [])];
    }
    await window.dash.agent.answer({ requestId: q.requestId, answers });
  };
  const answered = q.questions.filter((qq) => (picked[qq.id]?.length ?? 0) > 0 || (other[qq.id] ?? "").trim()).length;
  return (
    <div className="pop-in overflow-hidden rounded-2xl border border-lilac/35 bg-surface shadow-[0_14px_34px_-24px_rgba(124,108,246,0.9)]">
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <img src="dash://brand/scene-think.png" alt="" width={34} height={34} className="shrink-0" />
        <div className="text-[13px] leading-snug text-ink">{q.intro ?? "A few quick questions so I build exactly what you need."}</div>
      </div>
      <div className="space-y-3.5 px-3.5 py-3">
        {q.questions.map((qq, n) => (
          <div key={qq.id}>
            <div className="mb-1.5 text-[12.5px] font-semibold text-ink">
              {n + 1}. {qq.question}
              {qq.multi && <span className="ml-1 font-normal text-muted">(pick any)</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {qq.options.map((o) => {
                const on = picked[qq.id]?.includes(o);
                return (
                  <button
                    key={o}
                    onClick={() => toggle(qq.id, o, qq.multi)}
                    className={clsx("pressable rounded-full border px-3 py-1.5 text-left text-[12.5px] font-medium", on ? "border-lilac bg-lilac text-white" : "border-line bg-surface text-ink-2 hover:border-lilac/40")}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            <input
              value={other[qq.id] ?? ""}
              onChange={(e) => setOther((p) => ({ ...p, [qq.id]: e.target.value }))}
              placeholder="Or type your own…"
              className="mt-1.5 h-8 w-full rounded-xl border border-line bg-surface px-2.5 text-[12.5px] outline-none placeholder:text-muted focus:border-lilac selectable"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5">
        <button onClick={() => void submit()} disabled={sending} className="text-[12px] font-medium text-muted hover:text-ink">
          Skip, use your judgment
        </button>
        <Button variant="primary" size="sm" loading={sending} onClick={() => void submit()}>
          Continue{answered ? ` (${answered}/${q.questions.length})` : ""}
        </Button>
      </div>
    </div>
  );
}
