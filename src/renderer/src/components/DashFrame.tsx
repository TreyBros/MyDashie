import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { DashboardManifest } from "@shared/types";

export interface FrameSelection {
  id: string;
  title: string;
  kind: string;
  page?: string;
}

interface Frame {
  key: string;
  src: string;
}

interface FrameState {
  page?: string;
  scrollY?: number;
  cards?: string[];
}

const REVEAL_FADE_MS = 260;
const READY_TIMEOUT_MS = 6000;

/**
 * Double-buffered dashboard viewer. The visible page stays painted while a new version loads
 * in a second, hidden frame; when that frame reports it has rendered, it is revealed on the same
 * tab and scroll position with only its new cards animating, then the old frame is dropped.
 * No white flash, no re-animation, even while Dashie writes the page in several passes.
 */
export function DashFrame({ d, theme, frameRef, onSelected, onSelectCancel }: { d: DashboardManifest; theme: "light" | "dark"; frameRef: React.MutableRefObject<HTMLIFrameElement | null>; onSelected?: (sel: FrameSelection) => void; onSelectCancel?: () => void }) {
  const [live, setLive] = useState<Frame | null>(null);
  const [next, setNext] = useState<Frame | null>(null);
  const [revealed, setRevealed] = useState(false);
  const liveEl = useRef<HTMLIFrameElement | null>(null);
  const nextEl = useRef<HTMLIFrameElement | null>(null);
  const state = useRef<FrameState>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stamp = `${d.htmlVersion ?? 0}|${d.dataFetchedAt ?? ""}|${theme}`;
  const srcFor = (staged: boolean) => `dash://dashboards/${d.id}/index.html?theme=${theme}&v=${d.htmlVersion ?? 0}&t=${encodeURIComponent(d.dataFetchedAt ?? "")}${staged ? "&staged=1" : ""}`;

  // A new version: load it behind the current one.
  useEffect(() => {
    if (!live) {
      setLive({ key: stamp, src: srcFor(false) });
      return;
    }
    if (live.key === stamp || next?.key === stamp) return;
    setRevealed(false);
    setNext({ key: stamp, src: srcFor(true) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const promote = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNext((n) => {
      if (n) {
        setLive(n);
        liveEl.current = nextEl.current;
        frameRef.current = nextEl.current;
      }
      return null;
    });
    setRevealed(false);
  }, [frameRef]);

  const reveal = useCallback(() => {
    nextEl.current?.contentWindow?.postMessage({ type: "dash-reveal", page: state.current.page, scrollY: state.current.scrollY, prevCards: state.current.cards ?? [] }, "*");
    setRevealed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(promote, REVEAL_FADE_MS);
  }, [promote]);

  // If the new frame never says it's ready (a page error), show it anyway rather than hanging on the old one.
  useEffect(() => {
    if (!next) return;
    const t = setTimeout(reveal, READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [next, reveal]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      const msg = e.data as { type?: string } & FrameState & Partial<FrameSelection>;
      if (!msg || typeof msg.type !== "string") return;
      const fromLive = e.source === liveEl.current?.contentWindow;
      const fromNext = e.source === nextEl.current?.contentWindow;
      if (!fromLive && !fromNext) return;
      if (msg.type === "dash-ready" || msg.type === "dash-state") {
        if (fromLive) state.current = { page: msg.page ?? state.current.page, scrollY: msg.scrollY ?? state.current.scrollY, cards: msg.cards ?? state.current.cards };
        if (fromNext && msg.type === "dash-ready") reveal();
        return;
      }
      if (msg.type === "dash-selected" && fromLive) onSelected?.({ id: msg.id ?? "", title: msg.title ?? "", kind: msg.kind ?? "card", page: msg.page });
      if (msg.type === "dash-select-cancel" && fromLive) onSelectCancel?.();
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onSelected, onSelectCancel, reveal]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const sandbox = "allow-scripts allow-popups allow-popups-to-escape-sandbox";
  return (
    <>
      {live && (
        <iframe
          ref={(el) => {
            liveEl.current = el;
            if (el) frameRef.current = el;
          }}
          key={live.key}
          title={d.name}
          src={live.src}
          sandbox={sandbox}
          className="absolute inset-0 h-full w-full border-0 bg-white"
        />
      )}
      {next && (
        <iframe
          ref={(el) => {
            nextEl.current = el;
          }}
          key={next.key}
          title={`${d.name} (loading)`}
          src={next.src}
          sandbox={sandbox}
          aria-hidden={!revealed}
          className={clsx("absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-200 ease-out", revealed ? "opacity-100" : "pointer-events-none opacity-0")}
        />
      )}
    </>
  );
}
