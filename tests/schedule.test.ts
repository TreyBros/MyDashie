import { describe, it, expect } from "vitest";
import { Cron } from "croner";
import { specToCron, describeSpec, shortSpec, DEFAULT_SPEC, type ScheduleSpec } from "../src/shared/schedule";

const spec = (p: Partial<ScheduleSpec>): ScheduleSpec => ({ ...DEFAULT_SPEC, ...p });
const ALL = [0, 1, 2, 3, 4, 5, 6];

describe("specToCron", () => {
  it("compiles set-time schedules", () => {
    expect(specToCron(spec({ freq: "time", days: [1, 2, 3, 4, 5], time: "07:30" }))).toBe("30 7 * * 1-5");
    expect(specToCron(spec({ freq: "time", days: ALL, time: "18:00" }))).toBe("0 18 * * *");
    expect(specToCron(spec({ freq: "time", days: [1, 3, 5], time: "09:00" }))).toBe("0 9 * * 1,3,5");
  });
  it("compiles intervals with and without a work-hours window", () => {
    expect(specToCron(spec({ freq: "interval", every: 15, unit: "minutes", days: ALL, window: null }))).toBe("*/15 * * * *");
    expect(specToCron(spec({ freq: "interval", every: 2, unit: "hours", days: [1, 2, 3, 4, 5], window: { start: "08:00", end: "18:00" } }))).toBe("0 8-18/2 * * 1-5");
    expect(specToCron(spec({ freq: "interval", every: 1, unit: "hours", days: ALL, window: null }))).toBe("0 * * * *");
  });
  it("compiles monthly including last day", () => {
    expect(specToCron(spec({ freq: "monthly", dayOfMonth: 1, time: "06:00" }))).toBe("0 6 1 * *");
    expect(specToCron(spec({ freq: "monthly", dayOfMonth: "last", time: "17:00" }))).toBe("0 17 L * *");
  });
  it("produces cron the scheduler can run", () => {
    for (const s of [spec({ freq: "monthly", dayOfMonth: "last" }), spec({ freq: "interval", every: 30, unit: "minutes", window: { start: "09:00", end: "17:00" } })]) {
      expect(new Cron(specToCron(s)).nextRun()).toBeInstanceOf(Date);
    }
  });
});

describe("describeSpec", () => {
  it("reads like a sentence", () => {
    expect(describeSpec(spec({ freq: "time", days: [1, 2, 3, 4, 5], time: "07:00" }))).toBe("On weekdays at 7:00 AM");
    expect(describeSpec(spec({ freq: "time", days: [1], time: "08:00" }))).toBe("Every Monday at 8:00 AM");
    expect(describeSpec(spec({ freq: "interval", every: 2, unit: "hours", days: [1, 2, 3, 4, 5], window: { start: "08:00", end: "18:00" } }))).toBe("Every 2 hours from 8:00 AM to 6:00 PM on weekdays");
    expect(describeSpec(spec({ freq: "monthly", dayOfMonth: 2, time: "13:15" }))).toBe("Once a month on the 2nd at 1:15 PM");
  });
  it("has short labels for buttons", () => {
    expect(shortSpec(spec({ freq: "time", days: [1, 2, 3, 4, 5], time: "07:00" }))).toBe("Weekdays 7:00 AM");
    expect(shortSpec(spec({ freq: "interval", every: 1, unit: "hours" }))).toBe("Every hour");
  });
});
