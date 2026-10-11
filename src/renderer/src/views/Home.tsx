import { clsx } from "clsx";
import { GlyphPlus, Pic, Spinner, TopicIcon } from "../components/icons";

import { useStore, relativeTime } from "../lib/store";
import { LiveMascot } from "../components/LiveMascot";
import { Button, Chip, Mascot } from "../components/ui";
import type { DashboardManifest } from "@shared/types";
import { useState } from "react";
import { RenameField } from "../components/RenameField";

export function Home() {
  const dashboards = useStore((s) => s.dashboards);
  const navigate = useStore((s) => s.navigate);

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex items-center justify-between px-8 pt-10 pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Your dashboards</h1>
          <p className="mt-0.5 text-sm text-muted">{dashboards.length === 0 ? "Nothing here yet." : `${dashboards.length} dashboard${dashboards.length === 1 ? "" : "s"}, kept fresh on their schedules.`}</p>
        </div>
        <div className="no-drag">
          <Button variant="primary" onClick={() => navigate({ name: "new" })}>
            <GlyphPlus size={16} /> New dashboard
          </Button>
        </div>
      </header>

      {dashboards.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 overflow-y-auto px-8 pb-8">
          {dashboards.map((d, i) => (
            <DashboardCard key={d.id} d={d} index={i} onOpen={() => navigate({ name: "dashboard", id: d.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const navigate = useStore((s) => s.navigate);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16 text-center">
      <LiveMascot mood="hello" size={210} interval={3000} />
      <h2 className="mt-2 text-[20px] font-semibold tracking-tight">Hi, I'm Dashie.</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">Tell me what you want to see, and I'll pull the data, build the dashboard, and keep it fresh on whatever schedule you pick.</p>
      <Button variant="primary" size="lg" className="mt-6" onClick={() => navigate({ name: "new" })}>
        Build my first dashboard
      </Button>
    </div>
  );
}

export function statusChip(d: DashboardManifest) {
  switch (d.status) {
    case "building":
      return <Chip tone="lilac">Building…</Chip>;
    case "refreshing":
      return <Chip tone="lilac"><Spinner size={12} /> Refreshing</Chip>;
    case "stale":
      return <Chip tone="peach">Needs attention</Chip>;
    case "error":
      return <Chip tone="rose">Build failed</Chip>;
    case "draft":
      return <Chip tone="neutral">Draft</Chip>;
    default:
      return d.schedule.kind === "off" ? <Chip tone="neutral">Manual</Chip> : <Chip tone="mint"><Pic name="schedule" size={13} /> Scheduled</Chip>;
  }
}

function DashboardCard({ d, onOpen, index }: { d: DashboardManifest; onOpen: () => void; index: number }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !renaming && onOpen()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
        if (e.key === "F2") setRenaming(true);
      }}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={clsx("card pop-in group flex cursor-default flex-col outline-none focus-visible:ring-2 focus-visible:ring-lilac/40 overflow-hidden text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_rgba(28,27,40,0.35)]")}
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-2">
        {d.thumbnailVersion ? (
          <img src={`dash://dashboards/${d.id}/thumbnail.png?v=${d.thumbnailVersion}`} alt="" className="h-full w-full object-cover object-top" draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <LiveMascot mood={d.status === "building" ? "building" : d.status === "error" ? "trouble" : "idle"} size={116} interval={3400} />
          </div>
        )}
        <div className="absolute left-3 top-3">{statusChip(d)}</div>
      </div>
      <div className="flex items-start gap-3 p-4">
        <TopicIcon topic={d.icon} size={30} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameField id={d.id} name={d.name} onDone={() => setRenaming(false)} className="h-8 w-full text-[15px] font-semibold" />
          ) : (
            <div className="flex items-center gap-1">
              <div className="min-w-0 truncate text-[15px] font-semibold text-ink">{d.name}</div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming(true);
                }}
                aria-label={`Rename ${d.name}`}
                title="Rename"
                className="pressable -my-1 shrink-0 rounded-md p-1 opacity-0 transition-opacity duration-150 hover:bg-surface-2 focus-visible:opacity-100 group-hover:opacity-80"
              >
                <Pic name="edit" size={15} />
              </button>
            </div>
          )}
          <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{d.description || d.prompt}</div>
          <div className="mt-2 text-[11.5px] text-muted">Updated {relativeTime(d.dataFetchedAt)}</div>
        </div>
      </div>
    </div>
  );
}
