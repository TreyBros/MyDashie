import { clsx } from "clsx";
import { Spinner } from "./icons";
export { Spinner };

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const base = "pressable inline-flex items-center justify-center gap-2 font-medium rounded-full whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac";
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" }[size];
  const variants: Record<Variant, string> = {
    primary: "bg-lilac text-white hover:brightness-110 shadow-[0_6px_18px_-8px_rgba(124,108,246,0.7)]",
    secondary: "bg-surface border border-line-strong text-ink hover:bg-surface-2",
    soft: "bg-lilac-soft text-lilac hover:brightness-[0.98] dark:text-[#c9c0ff]",
    ghost: "text-ink-2 hover:bg-surface-2",
    danger: "bg-rose-soft text-danger hover:brightness-[0.98]",
  };
  return (
    <button className={clsx(base, sizes, variants[variant], className)} {...rest}>
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function IconButton({ className, children, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx("pressable inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "h-10 w-full rounded-2xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted outline-none transition focus:border-lilac focus:ring-4 focus:ring-lilac/15 selectable",
        className
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-muted outline-none transition focus:border-lilac focus:ring-4 focus:ring-lilac/15 selectable",
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "h-10 rounded-2xl border border-line bg-surface px-3 pr-8 text-sm text-ink outline-none focus:border-lilac focus:ring-4 focus:ring-lilac/15 appearance-none bg-no-repeat bg-[right_10px_center]",
        className
      )}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a7888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lilac", checked ? "bg-lilac" : "bg-surface-3")}
    >
      <span
        className={clsx("absolute left-0 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200", checked ? "translate-x-6" : "translate-x-1")}
        style={{ transitionTimingFunction: "var(--ease-spring)" }}
      />
    </button>
  );
}

export function Chip({ tone = "neutral", children, className }: { tone?: "neutral" | "lilac" | "mint" | "peach" | "rose" | "butter"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    lilac: "bg-lilac-soft text-lilac dark:text-[#c9c0ff]",
    mint: "bg-mint-soft text-[#1f8a67] dark:text-[#8be5c6]",
    peach: "bg-peach-soft text-[#b86a2a] dark:text-[#ffc89c]",
    rose: "bg-rose-soft text-[#b3486f] dark:text-[#ffb3cf]",
    butter: "bg-butter-soft text-[#8a6b0a] dark:text-[#ffe08a]",
  }[tone];
  return <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", tones, className)}>{children}</span>;
}


export function Mascot({ pose = "dashy", size = 160, className, bob }: { pose?: "dashy" | "dashy-wave" | "dashy-building" | "dashy-sleeping" | "dashy-celebrate" | "dashy-worried" | "dashy-peek"; size?: number; className?: string; bob?: boolean }) {
  return <img src={`dash://brand/${pose}.png`} width={size} height={size} alt="" draggable={false} className={clsx("select-none", bob && "bob", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[13px] font-medium text-ink-2">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </label>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}
