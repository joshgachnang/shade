import {z} from "zod";

export const edgeAgentConfigSchema = z.object({
  pollIntervalMs: z.number().default(5000),
  heartbeatIntervalMs: z.number().default(30000),
  configPollIntervalMs: z.number().default(60000),
  features: z.record(z.string(), z.boolean()).default({}),
  mcpServerUrl: z.string().optional(),
  imessage: z
    .object({
      dbPath: z.string().optional(),
      chatFilters: z.array(z.string()).optional(),
    })
    .optional(),
  reminders: z
    .object({
      enabled: z.boolean().default(true),
      syncIntervalMs: z.number().default(15 * 60 * 1000),
    })
    .optional(),
  calendar: z
    .object({
      enabled: z.boolean().default(true),
      syncIntervalMs: z.number().default(15 * 60 * 1000),
      daysAhead: z.number().default(90),
      calendarFilters: z.array(z.string()).optional(),
    })
    .optional(),
});

export const configResponseSchema = z.object({
  config: edgeAgentConfigSchema,
  secrets: z.record(z.string(), z.unknown()).default({}),
});

export type EdgeAgentConfig = z.infer<typeof edgeAgentConfigSchema>;
export type ConfigResponse = z.infer<typeof configResponseSchema>;
