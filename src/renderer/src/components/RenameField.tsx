import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Inline rename: opens with the whole name selected. Enter or clicking away saves,
 * Escape cancels, and an empty name quietly keeps the old one.
 */
export function RenameField({ id, name, onDone, className }: { id: string; name: string; onDone: () => void; className?: string }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  async function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    const next = value.trim().replace(/\s+/g, " ");
    onDone();
    if (!save || !next || next === name) return;
    try {
      await window.dash.dashboards.update({ id, patch: { name: next } });
      toast.success(`Renamed to “${next}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rename the dashboard");
    }
  }

  return (
    <input
      ref={ref}
      value={value}
      maxLength={80}
      aria-label="Dashboard name"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void finish(true);
        if (e.key === "Escape") void finish(false);
      }}
      className={clsx("no-drag selectable min-w-0 rounded-lg border border-lilac/60 bg-surface px-2 outline-none ring-4 ring-lilac/15", className)}
    />
  );
}
