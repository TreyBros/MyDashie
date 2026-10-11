import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Button } from "./ui";
import { GlyphArrowUp, GlyphCheck, GlyphClose, Pic, TopicIcon } from "./icons";

interface Slide {
  art: string;
  title: string;
  body: string;
  demo: React.ReactNode;
}

const APPS = ["Stripe", "HubSpot", "Google Sheets", "Salesforce", "Notion", "Granola", "Slack", "Linear", "Jira", "GitHub", "Shopify", "QuickBooks", "Google Analytics", "Airtable", "Postgres", "Excel files"];

function TypingPrompt() {
  const lines = ["Weekly revenue by plan, compared to last month", "Pipeline by stage and the deals closing this quarter", "My meetings this month and every open action item"];
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    const full = lines[i]!;
    if (n < full.length) {
      const t = setTimeout(() => setN(n + 1), 28);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setI((i + 1) % lines.length);
      setN(0);
    }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, i]);
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-[0_14px_34px_-24px_rgba(124,108,246,0.8)]">
      <div className="flex items-center gap-2.5">
        <div className="min-h-[22px] flex-1 text-[14px] text-ink">
          {lines[i]!.slice(0, n)}
          <span className="ml-px inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-lilac" />
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lilac text-white">
          <GlyphArrowUp size={14} />
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5 text-[12px] text-muted">
        <span className="flex size-4 items-center justify-center rounded-full bg-mint text-white">
          <GlyphCheck size={10} />
        </span>
        Dashie plans it, pulls the data, builds it, and checks its own work.
      </div>
    </div>
  );
}

function AppCloud() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {APPS.map((a, i) => (
        <span
          key={a}
          className="pop-in rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2"
          style={{ animationDelay: `${i * 35}ms` }}
        >
          {a}
        </span>
      ))}
      <span className="pop-in rounded-full bg-lilac-soft px-3 py-1.5 text-[12.5px] font-semibold text-lilac dark:text-[#c9c0ff]" style={{ animationDelay: `${APPS.length * 35}ms` }}>
        + 1,600 more
      </span>
    </div>
  );
}

function ScheduleDemo() {
  return (
    <div className="space-y-2">
      {[
        { t: "Weekday mornings", s: "Mon–Fri at 7:00 AM" },
        { t: "Every hour, work hours", s: "8:00 AM to 6:00 PM" },
        { t: "Monthly report", s: "1st of the month at 9:00 AM" },
      ].map((r, i) => (
        <div key={r.t} className="pop-in flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-2.5" style={{ animationDelay: `${i * 70}ms` }}>
          <Pic name="schedule" size={22} />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-ink">{r.t}</div>
            <div className="text-[12px] text-muted">{r.s}</div>
          </div>
          {i === 0 && (
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#1f8a67] dark:text-[#8be5c6]">
              <span className="size-2 rounded-full bg-mint pulse-soft" /> On
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LibraryDemo() {
  const items: { topic: string; name: string }[] = [
    { topic: "revenue", name: "Stripe Revenue" },
    { topic: "sales", name: "Sales Pipeline" },
    { topic: "meetings", name: "Meeting Pulse" },
    { topic: "traffic", name: "Site Traffic" },
    { topic: "support", name: "Support Queue" },
    { topic: "engineering", name: "Eng Velocity" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it, i) => (
        <div key={it.name} className="pop-in flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2.5" style={{ animationDelay: `${i * 50}ms` }}>
          <TopicIcon topic={it.topic} size={26} />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink">{it.name}</div>
            <div className="text-[11.5px] text-muted">Updated {i === 0 ? "just now" : `${i * 7} min ago`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    art: "about-hero",
    title: "Self-service reporting, done for you",
    body: "MyDashie turns a sentence into a live dashboard. Dashie, our dashboard agent, specializes in two things: building great dashboards and connecting to your data. No queries, no spreadsheets, no waiting on a data team.",
    demo: <TypingPrompt />,
  },
  {
    art: "about-connect",
    title: "Connect any tool you already use",
    body: "Sign in to your apps once and Dashie reads exactly what it needs. Spreadsheets and files on your Mac work too, and your team can plug in its own internal tools.",
    demo: <AppCloud />,
  },
  {
    art: "about-schedule",
    title: "Always fresh, on any schedule",
    body: "Every hour, weekday mornings, or the first of the month. MyDashie refreshes quietly from your menu bar, fixes small hiccups on its own, and only taps you if it needs a hand.",
    demo: <ScheduleDemo />,
  },
  {
    art: "about-library",
    title: "Every dashboard, in one place",
    body: "Your whole reporting library lives here. Open any dashboard in a click, change it with a sentence, save it as a file, or open it in your browser to share.",
    demo: <LibraryDemo />,
  },
];

/**
 * The welcome tour. variant="first-run" fills the window on first launch; variant="about" is a modal from the sidebar.
 */
export function WelcomeTour({ variant, onDone }: { variant: "first-run" | "about"; onDone: (startBuilding: boolean) => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const last = i === SLIDES.length - 1;
  const go = useCallback(
    (n: number) => {
      if (n < 0 || n >= SLIDES.length) return;
      setDir(n > i ? 1 : -1);
      setI(n);
    },
    [i]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") last ? onDone(variant === "first-run") : go(i + 1);
      if (e.key === "ArrowLeft") go(i - 1);
      if (e.key === "Escape" && variant === "about") onDone(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, last, go, onDone, variant]);

  // preload art
  useEffect(() => {
    for (const s of SLIDES) {
      const img = new Image();
      img.src = `dash://brand/${s.art}.png`;
    }
  }, []);

  const s = SLIDES[i]!;
  const card = (
    <div
      role="dialog"
      aria-modal
      aria-label="About MyDashie"
      className="no-drag pop-in relative grid w-full max-w-[980px] grid-cols-[1.05fr_1fr] overflow-hidden rounded-[28px] border border-line bg-surface shadow-[0_40px_120px_-40px_rgba(60,40,140,0.45)]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* art panel */}
      <div className="relative min-h-[520px] overflow-hidden bg-[radial-gradient(120%_90%_at_20%_10%,#efeaff_0%,#f7f4ff_45%,#eefaf4_100%)] dark:bg-[radial-gradient(120%_90%_at_20%_10%,#2a2547_0%,#1e1c2c_50%,#16251f_100%)]">
        <img src="dash://brand/wordmark.png" alt="MyDashie" className="absolute left-7 top-7 h-[26px] w-auto" draggable={false} />
        <img
          key={s.art}
          src={`dash://brand/${s.art}.png`}
          alt=""
          draggable={false}
          className="tour-art absolute inset-x-8 bottom-8 top-20 m-auto h-[calc(100%-7rem)] w-[calc(100%-4rem)] object-contain object-center drop-shadow-[0_24px_40px_rgba(90,70,180,0.18)]"
          style={{ ["--dir" as string]: dir }}
        />
      </div>

      {/* story panel */}
      <div className="flex flex-col px-9 pb-7 pt-9">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5" role="tablist" aria-label="Tour progress">
            {SLIDES.map((_, n) => (
              <button
                key={n}
                role="tab"
                aria-selected={n === i}
                aria-label={`Step ${n + 1}`}
                onClick={() => go(n)}
                className={clsx("h-1.5 rounded-full transition-all duration-300", n === i ? "w-7 bg-lilac" : n < i ? "w-3 bg-lilac/50" : "w-3 bg-surface-3")}
                style={{ transitionTimingFunction: "var(--ease-out-strong)" }}
              />
            ))}
          </div>
          {variant === "about" ? (
            <button aria-label="Close" onClick={() => onDone(false)} className="-mr-2 flex size-8 items-center justify-center rounded-full text-muted hover:bg-surface-2">
              <GlyphClose size={16} />
            </button>
          ) : (
            !last && (
              <button onClick={() => onDone(false)} className="text-[12.5px] font-medium text-muted hover:text-ink">
                Skip
              </button>
            )
          )}
        </div>

        <div key={i} className="tour-copy mt-8 flex flex-1 flex-col" style={{ ["--dir" as string]: dir }}>
          <h2 className="text-balance text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">{s.title}</h2>
          <p className="mt-3 text-pretty text-[15px] leading-relaxed text-ink-2">{s.body}</p>
          <div className="mt-6">{s.demo}</div>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <Button variant="ghost" onClick={() => go(i - 1)} className={clsx(i === 0 && "invisible")}>
            Back
          </Button>
          {last ? (
            <Button variant="primary" size="lg" onClick={() => onDone(variant === "first-run")}>
              {variant === "first-run" ? "Build my first dashboard" : "Got it"}
              {variant === "first-run" && <GlyphArrowUp size={16} className="rotate-90" />}
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => go(i + 1)}>
              Next <GlyphArrowUp size={16} className="rotate-90" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (variant === "first-run") {
    return (
      <div className="drag flex h-full items-center justify-center bg-[radial-gradient(80%_70%_at_50%_0%,rgba(124,108,246,0.12),transparent_70%)] p-10">
        {card}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,18,32,0.38)] p-8 backdrop-blur-[3px]" onMouseDown={() => onDone(false)}>
      {card}
    </div>
  );
}
