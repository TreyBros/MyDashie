/**
 * MyDashie icon system.
 *  - <Pic name="…"/> renders one of the generated pastel-3D icons (resources/brand/icon-*.png), made for this app.
 *  - A handful of micro-glyphs (check, chevron, close, spinner) are drawn here by hand so they stay crisp at 12-16px.
 * No third-party icon fonts or libraries.
 */
import { clsx } from "clsx";
import type { SVGProps } from "react";

export type PicName =
  | "new" | "home" | "settings" | "ai" | "apps" | "mcp" | "general" | "schedule" | "refresh" | "export" | "browser"
  | "folder" | "trash" | "edit" | "link" | "file" | "send" | "stop" | "check" | "alert" | "close" | "more" | "chevron" | "search" | "key";

export function Pic({ name, size = 20, className, spin }: { name: PicName; size?: number; className?: string; spin?: boolean }) {
  return (
    <img
      src={`dash://brand/icon-${name}.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={clsx("inline-block shrink-0 select-none object-contain", spin && "animate-spin", className)}
      style={{ width: size, height: size }}
    />
  );
}

type G = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number | undefined, className?: string) => ({
  width: size ?? 16,
  height: size ?? 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: clsx("shrink-0", className),
  "aria-hidden": true,
});

export const GlyphCheck = ({ size, className, ...p }: G) => (
  <svg {...base(size, className)} {...p}>
    <path d="M5 12.5 9.5 17 19 7.5" />
  </svg>
);
export const GlyphChevron = ({ size, className, ...p }: G) => (
  <svg {...base(size, className)} {...p}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </svg>
);
export const GlyphClose = ({ size, className, ...p }: G) => (
  <svg {...base(size, className)} {...p}>
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
);
export const GlyphPlus = ({ size, className, ...p }: G) => (
  <svg {...base(size, className)} {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);
export const GlyphArrowUp = ({ size, className, ...p }: G) => (
  <svg {...base(size, className)} {...p}>
    <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
  </svg>
);
export const GlyphDot = ({ size, className, ...p }: G) => (
  <svg {...base(size, className)} {...p} stroke="none" fill="currentColor">
    <circle cx="12" cy="12" r="5" />
  </svg>
);
/** Soft ring spinner: a lilac arc on a faint track. */
export const Spinner = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={clsx("shrink-0 animate-spin", className)} aria-hidden>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
    <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/** Generated topic icon for a dashboard (falls back to "general"). */
export function TopicIcon({ topic, size = 20, className }: { topic?: string; size?: number; className?: string }) {
  const t = topic || "general";
  return (
    <img
      src={`dash://brand/topic-${t}.png`}
      onError={(e) => { (e.currentTarget as HTMLImageElement).src = "dash://brand/topic-general.png"; }}
      width={size}
      height={size}
      alt=""
      aria-hidden
      draggable={false}
      className={clsx("inline-block shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
