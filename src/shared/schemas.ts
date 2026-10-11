import { z } from "zod";

export const scheduleSchema = z.object({
  kind: z.enum(["off", "interval", "cron"]),
  everyMinutes: z.number().int().min(5).max(60 * 24 * 31).optional(),
  cron: z.string().min(9).max(100).optional(),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  paused: z.boolean().optional(),
  spec: z
    .object({
      freq: z.enum(["interval", "time", "monthly"]),
      every: z.number().int().min(1).max(60),
      unit: z.enum(["minutes", "hours"]),
      window: z.object({ start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/) }).nullable(),
      days: z.array(z.number().int().min(0).max(6)).max(7),
      time: z.string().regex(/^\d\d:\d\d$/),
      dayOfMonth: z.union([z.number().int().min(1).max(28), z.literal("last")]),
    })
    .optional(),
});

export const dashboardIdSchema = z.string().regex(/^[a-z0-9]{10,24}$/);

export const powerChoiceSchema = z.enum(["auto", "quick", "smart", "max"]);

export const dashboardCreateSchema = z.object({
  name: z.string().min(1).max(80),
  prompt: z.string().min(1).max(20000),
});

export const dashboardUpdateSchema = z.object({
  id: dashboardIdSchema,
  patch: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    emoji: z.string().max(8).optional(),
    description: z.string().max(400).optional(),
    schedule: scheduleSchema.optional(),
  }),
});

export const modelChoiceSchema = z.object({
  model: z.string().min(1).max(80),
  effort: z.enum(["none", "low", "medium", "high", "xhigh", "max"]),
});

export const settingsPatchSchema = z.object({
  buildModel: modelChoiceSchema.optional(),
  refreshModel: modelChoiceSchema.optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  launchAtLogin: z.boolean().optional(),
  notifications: z.boolean().optional(),
  onboarded: z.boolean().optional(),
  developer: z.boolean().optional(),
  power: powerChoiceSchema.optional(),
});

export const secretSetSchema = z.object({
  key: z.enum(["openai", "composio"]),
  value: z.string().min(8).max(500),
});

export const runRequestSchema = z.object({
  dashboardId: dashboardIdSchema,
  message: z.string().min(1).max(20000),
  mode: z.enum(["build", "edit"]),
  selection: z.object({ id: z.string().max(120), title: z.string().max(200), kind: z.string().max(40), page: z.string().max(120).optional() }).optional(),
  intent: z.enum(["ask", "change"]).optional(),
  power: powerChoiceSchema.optional(),
  refundLast: z.boolean().optional(),
});

export const mcpTransportSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1).max(500),
    args: z.array(z.string().max(500)).max(50),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("http"),
    url: z.string().url().max(1000),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);

export const mcpServerSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  transport: mcpTransportSchema,
  enabled: z.boolean(),
});

export const mcpAddSchema = mcpServerSchema.omit({ id: true });
