/**
 * Friendly schedule model. The UI edits a ScheduleSpec; it is compiled to a 5-field cron
 * (local time) that the scheduler runs. Nobody has to see cron.
 */

export type Freq = "interval" | "time" | "monthly";

export interface ScheduleSpec {
  freq: Freq;
  /** interval: how often */
  every: number;
  unit: "minutes" | "hours";
  /** interval: optionally only between these hours ("HH:MM", 24h). null = all day */
  window: { start: string; end: string } | null;
  /** interval + time: days of week, 0=Sun..6=Sat */
  days: number[];
  /** time + monthly: "HH:MM" 24h */
  time: string;
  /** monthly: 1-28 or "last" */
  dayOfMonth: number | "last";
}

export const DEFAULT_SPEC: ScheduleSpec = {
  freq: "time",
  every: 1,
  unit: "hours",
  window: null,
  days: [1, 2, 3, 4, 5],
  time: "07:00",
  dayOfMonth: 1,
};

export const INTERVAL_CHOICES: { every: number; unit: "minutes" | "hours"; label: string }[] = [
  { every: 15, unit: "minutes", label: "15 minutes" },
  { every: 30, unit: "minutes", label: "30 minutes" },
  { every: 1, unit: "hours", label: "hour" },
  { every: 2, unit: "hours", label: "2 hours" },
  { every: 3, unit: "hours", label: "3 hours" },
  { every: 4, unit: "hours", label: "4 hours" },
  { every: 6, unit: "hours", label: "6 hours" },
  { every: 12, unit: "hours", label: "12 hours" },
];

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return { h: h ?? 0, m: m ?? 0 };
};

function dowField(days: number[]): string {
  const d = [...new Set(days)].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
  if (d.length === 0 || d.length === 7) return "*";
  // compress consecutive runs: [1,2,3,4,5] -> 1-5
  const parts: string[] = [];
  let i = 0;
  while (i < d.length) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${d[i]}-${d[j]}` : d.slice(i, j + 1).join(","));
    i = j + 1;
  }
  return parts.join(",");
}

export function specToCron(s: ScheduleSpec): string {
  const dow = dowField(s.days);
  if (s.freq === "monthly") {
    const { h, m } = hm(s.time);
    return `${m} ${h} ${s.dayOfMonth === "last" ? "L" : s.dayOfMonth} * *`;
  }
  if (s.freq === "time") {
    const { h, m } = hm(s.time);
    return `${m} ${h} * * ${dow}`;
  }
  // interval
  const startH = s.window ? hm(s.window.start).h : 0;
  const endH = s.window ? Math.max(startH, hm(s.window.end).h) : 23;
  const hours = s.window ? `${startH}-${endH}` : "*";
  if (s.unit === "minutes") return `*/${s.every} ${hours} * * ${dow}`;
  if (s.every === 1) return `0 ${hours} * * ${dow}`;
  return `0 ${hours}/${s.every} * * ${dow}`;
}

export function formatTime(t: string): string {
  const { h, m } = hm(t);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function daysPhrase(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 0 || d.length === 7) return "every day";
  if (d.join() === "1,2,3,4,5") return "on weekdays";
  if (d.join() === "0,6") return "on weekends";
  if (d.length === 1) return `every ${DAY_LONG[d[0]!]}`;
  return `on ${d.map((x) => DAY_SHORT[x]).join(", ")}`;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** Full sentence: "Every 2 hours from 8:00 AM to 6:00 PM on weekdays". */
export function describeSpec(s: ScheduleSpec): string {
  if (s.freq === "monthly") return `Once a month on the ${s.dayOfMonth === "last" ? "last day" : ordinal(s.dayOfMonth)} at ${formatTime(s.time)}`;
  if (s.freq === "time") {
    const p = daysPhrase(s.days);
    return `${p.charAt(0).toUpperCase()}${p.slice(1)} at ${formatTime(s.time)}`;
  }
  const choice = INTERVAL_CHOICES.find((c) => c.every === s.every && c.unit === s.unit);
  const freq = `Every ${choice?.label ?? `${s.every} ${s.unit}`}`;
  const win = s.window ? ` from ${formatTime(s.window.start)} to ${formatTime(s.window.end)}` : "";
  const days = s.days.length === 7 || s.days.length === 0 ? "" : ` ${daysPhrase(s.days)}`;
  return `${freq}${win}${days}`;
}

/** Short label for buttons: "Weekdays 7:00 AM", "Every hour". */
export function shortSpec(s: ScheduleSpec): string {
  if (s.freq === "monthly") return `Monthly, ${s.dayOfMonth === "last" ? "last day" : ordinal(s.dayOfMonth)}`;
  if (s.freq === "time") {
    const p = daysPhrase(s.days);
    const lead = p === "every day" ? "Daily" : p === "on weekdays" ? "Weekdays" : p === "on weekends" ? "Weekends" : p.replace(/^every /, "").replace(/^on /, "");
    return `${lead.charAt(0).toUpperCase()}${lead.slice(1)} ${formatTime(s.time)}`;
  }
  const choice = INTERVAL_CHOICES.find((c) => c.every === s.every && c.unit === s.unit);
  return `Every ${choice?.label ?? `${s.every} ${s.unit}`}`;
}

export const PRESETS: { label: string; spec: ScheduleSpec }[] = [
  { label: "Every hour", spec: { ...DEFAULT_SPEC, freq: "interval", every: 1, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], window: null } },
  { label: "Every morning", spec: { ...DEFAULT_SPEC, freq: "time", days: [0, 1, 2, 3, 4, 5, 6], time: "07:00" } },
  { label: "Weekday mornings", spec: { ...DEFAULT_SPEC, freq: "time", days: [1, 2, 3, 4, 5], time: "08:00" } },
  { label: "Work hours", spec: { ...DEFAULT_SPEC, freq: "interval", every: 1, unit: "hours", days: [1, 2, 3, 4, 5], window: { start: "08:00", end: "18:00" } } },
  { label: "Monday mornings", spec: { ...DEFAULT_SPEC, freq: "time", days: [1], time: "08:00" } },
];

/** Every 15 minutes, for time dropdowns. */
export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

const WEEKS_PER_MONTH = 30.44 / 7;

/** About how many times a schedule runs in a month (0 when it's off or paused; null when it can't tell). */
export function runsPerMonth(s: { kind: string; spec?: ScheduleSpec; everyMinutes?: number; paused?: boolean } | undefined): number | null {
  if (!s || s.kind === "off" || s.paused) return 0;
  const spec = s.spec;
  if (!spec) return s.kind === "interval" && s.everyMinutes ? (30.44 * 24 * 60) / s.everyMinutes : null;
  if (spec.freq === "monthly") return 1;
  const daysPerWeek = spec.days.length || 7;
  if (spec.freq === "time") return daysPerWeek * WEEKS_PER_MONTH;
  return runsPerActiveDay(spec) * daysPerWeek * WEEKS_PER_MONTH;
}

/** Runs on a day the schedule is active. */
export function runsPerActiveDay(spec: ScheduleSpec): number {
  if (spec.freq !== "interval") return 1;
  // mirrors specToCron (an hour range is inclusive; "*/n" minutes fire 60/n times an hour)
  const startH = spec.window ? hm(spec.window.start).h : 0;
  const endH = spec.window ? Math.max(startH, hm(spec.window.end).h) : 23;
  const hours = endH - startH + 1;
  return spec.unit === "minutes" ? hours * Math.ceil(60 / spec.every) : Math.ceil(hours / spec.every);
}

/** The free plan refreshes a dashboard at most this often in a day (every 2 hours); paid plans go to every 15 minutes. */
export const FREE_MAX_RUNS_PER_DAY = 12;
