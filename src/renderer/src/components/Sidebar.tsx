import { clsx } from "clsx";
import { GlyphPlus, Pic, TopicIcon } from "./icons";

import { useStore } from "../lib/store";
import { RenameField } from "./RenameField";
import { useState } from "react";

export function Sidebar() {
  const route = useStore((s) => s.route);
  const dashboards = useStore((s) => s.dashboards);
  const runs = useStore((s) => s.runs);
  const navigate = useStore((s) => s.navigate);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const isMac = window.dash.app.platform === "darwin";

  return (
    <aside className="drag flex w-[232px] shrink-0 flex-col border-r border-line bg-surface-2/60">
      <div className={clsx("flex items-center gap-2 px-4", isMac ? "pt-11 pb-3" : "pt-4 pb-3")}>
        <img src="dash://brand/dashy.png" width={30} height={30} alt="" className="no-drag" draggable={false} />
        <img src="dash://brand/wordmark.png" alt="MyDashie" draggable={false} className="h-[22px] w-auto select-none" />
      </div>

      <div className="no-drag px-3">
        <button
          onClick={() => navigate({ name: "new" })}
          className={clsx(
            "pressable flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium",
            route.name === "new" ? "bg-lilac text-white shadow-[0_8px_20px_-10px_rgba(124,108,246,0.8)]" : "bg-surface text-ink border border-line hover:border-line-strong"
          )}
        >
          <GlyphPlus size={16} />
          New dashboard
        </button>
      </div>

      <nav className="no-drag mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        <NavItem active={route.name === "home"} onClick={() => navigate({ name: "home" })} icon={<Pic name="home" size={20} />}>
          All dashboards
        </NavItem>
        {dashboards.length > 0 && <div className="mt-3 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Dashboards</div>}
        {dashboards.map((d) => {
          const active = route.name === "dashboard" && route.id === d.id;
          const running = runs[d.id]?.running || d.status === "refreshing" || d.status === "building";
          return (
            <NavItem key={d.id} active={active} onClick={() => navigate({ name: "dashboard", id: d.id })} onDoubleClick={() => setRenamingId(d.id)} title="Double-click to rename" icon={<TopicIcon topic={d.icon} size={20} />}>
              {renamingId === d.id ? <RenameField id={d.id} name={d.name} onDone={() => setRenamingId(null)} className="h-7 w-full text-[14px]" /> : <span className="truncate">{d.name}</span>}
              {running && <Pic name="ai" size={16} className="ml-auto pulse-soft" />}
              {!running && d.status === "stale" && <span className="ml-auto size-2 shrink-0 rounded-full bg-peach" title="Needs attention" />}
            </NavItem>
          );
        })}
      </nav>

      <div className="no-drag border-t border-line p-2">
        <NavItem active={false} onClick={() => useStore.getState().setAbout(true)} icon={<Pic name="ai" size={20} />}>
          About MyDashie
        </NavItem>
        <NavItem active={route.name === "settings"} onClick={() => navigate({ name: "settings" })} icon={<Pic name="settings" size={20} />}>
          Settings
        </NavItem>
      </div>
    </aside>
  );
}

function NavItem({ active, onClick, onDoubleClick, title, icon, children }: { active: boolean; onClick: () => void; onDoubleClick?: () => void; title?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
        if (e.key === "F2" && onDoubleClick) onDoubleClick();
      }}
      className={clsx("cursor-default select-none outline-none focus-visible:ring-2 focus-visible:ring-lilac/40", 
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] transition-colors",
        active ? "bg-surface text-ink shadow-[0_1px_0_rgba(0,0,0,0.03)] border border-line" : "text-ink-2 hover:bg-surface/70 border border-transparent"
      )}
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">{children}</span>
    </div>
  );
}
