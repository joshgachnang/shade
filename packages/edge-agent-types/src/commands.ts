import {z} from "zod";

export const sendMessageCommandSchema = z.object({
  type: z.literal("send_message"),
  payload: z.object({
    to: z.string(),
    text: z.string(),
  }),
});

export const updateConfigCommandSchema = z.object({
  type: z.literal("update_config"),
  payload: z.object({
    config: z.record(z.string(), z.unknown()),
  }),
});

export const restartCommandSchema = z.object({
  type: z.literal("restart"),
  payload: z.object({}).default({}),
});

export const reportStatusCommandSchema = z.object({
  type: z.literal("report_status"),
  payload: z.object({}).default({}),
});

export const commandSchema = z.discriminatedUnion("type", [
  sendMessageCommandSchema,
  updateConfigCommandSchema,
  restartCommandSchema,
  reportStatusCommandSchema,
]);

export const commandResultSchema = z.object({
  commandId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  completedAt: z.string().optional(), // ISO 8601
});

export type SendMessageCommand = z.infer<typeof sendMessageCommandSchema>;
export type UpdateConfigCommand = z.infer<typeof updateConfigCommandSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
