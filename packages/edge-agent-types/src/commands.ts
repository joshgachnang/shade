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

export const createReminderCommandSchema = z.object({
  type: z.literal("create_reminder"),
  payload: z.object({
    title: z.string(),
    listName: z.string().optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(), // ISO 8601
    priority: z.number().min(0).max(9).optional(),
  }),
});

export const completeReminderCommandSchema = z.object({
  type: z.literal("complete_reminder"),
  payload: z.object({
    externalId: z.string(),
  }),
});

export const deleteReminderCommandSchema = z.object({
  type: z.literal("delete_reminder"),
  payload: z.object({
    externalId: z.string(),
  }),
});

export const createCalendarEventCommandSchema = z.object({
  type: z.literal("create_calendar_event"),
  payload: z.object({
    title: z.string(),
    calendarName: z.string().optional(),
    startDate: z.string(), // ISO 8601
    endDate: z.string(), // ISO 8601
    allDay: z.boolean().optional(),
    location: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const syncNowCommandSchema = z.object({
  type: z.literal("sync_now"),
  payload: z.object({}).default({}),
});

export const commandSchema = z.discriminatedUnion("type", [
  sendMessageCommandSchema,
  updateConfigCommandSchema,
  restartCommandSchema,
  reportStatusCommandSchema,
  createReminderCommandSchema,
  completeReminderCommandSchema,
  deleteReminderCommandSchema,
  createCalendarEventCommandSchema,
  syncNowCommandSchema,
]);

export const commandResultSchema = z.object({
  commandId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  completedAt: z.string().optional(), // ISO 8601
});

export type SendMessageCommand = z.infer<typeof sendMessageCommandSchema>;
export type UpdateConfigCommand = z.infer<typeof updateConfigCommandSchema>;
export type CreateReminderCommand = z.infer<typeof createReminderCommandSchema>;
export type CompleteReminderCommand = z.infer<typeof completeReminderCommandSchema>;
export type DeleteReminderCommand = z.infer<typeof deleteReminderCommandSchema>;
export type CreateCalendarEventCommand = z.infer<typeof createCalendarEventCommandSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
