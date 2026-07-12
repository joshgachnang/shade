import {z} from "zod";

export const messagePayloadSchema = z.object({
  externalId: z.string(),
  sender: z.string(),
  senderExternalId: z.string(),
  content: z.string(),
  groupExternalId: z.string(), // chat identifier
  timestamp: z.string(), // ISO 8601
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const messagesDataPushSchema = z.object({
  type: z.literal("messages"),
  payload: z.object({
    messages: z.array(messagePayloadSchema),
  }),
});

export const channelRequestPushSchema = z.object({
  type: z.literal("channel_request"),
  payload: z.object({
    channelType: z.string(),
    name: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const eventsDataPushSchema = z.object({
  type: z.literal("events"),
  payload: z.record(z.string(), z.unknown()),
});

export const reminderListPayloadSchema = z.object({
  externalId: z.string(),
  name: z.string(),
});

export const reminderPayloadSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  notes: z.string().nullish(),
  dueDate: z.string().nullish(), // ISO 8601
  priority: z.number().default(0),
  completed: z.boolean().default(false),
  listName: z.string(),
  listExternalId: z.string(),
});

/** Full snapshot of all incomplete reminders. Backend upserts and marks missing ones removed. */
export const remindersSyncPushSchema = z.object({
  type: z.literal("reminders_sync"),
  payload: z.object({
    lists: z.array(reminderListPayloadSchema),
    reminders: z.array(reminderPayloadSchema),
    syncedAt: z.string(), // ISO 8601
  }),
});

export const calendarPayloadSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  writable: z.boolean().optional(),
  color: z.string().nullish(),
});

export const calendarEventPayloadSchema = z.object({
  externalId: z.string(), // eventIdentifier plus occurrence date for recurring events
  title: z.string(),
  notes: z.string().nullish(),
  location: z.string().nullish(),
  url: z.string().nullish(),
  startDate: z.string(), // ISO 8601
  endDate: z.string(), // ISO 8601
  allDay: z.boolean().default(false),
  status: z.string().nullish(),
  calendarName: z.string(),
  calendarExternalId: z.string(),
});

/** Full snapshot of events in [rangeStart, rangeEnd). Backend upserts and marks missing ones in-range removed. */
export const calendarSyncPushSchema = z.object({
  type: z.literal("calendar_sync"),
  payload: z.object({
    calendars: z.array(calendarPayloadSchema),
    events: z.array(calendarEventPayloadSchema),
    rangeStart: z.string(), // ISO 8601
    rangeEnd: z.string(), // ISO 8601
    syncedAt: z.string(), // ISO 8601
  }),
});

export const dataPushSchema = z.discriminatedUnion("type", [
  messagesDataPushSchema,
  channelRequestPushSchema,
  eventsDataPushSchema,
  remindersSyncPushSchema,
  calendarSyncPushSchema,
]);

export type MessagePayload = z.infer<typeof messagePayloadSchema>;
export type MessagesDataPush = z.infer<typeof messagesDataPushSchema>;
export type ChannelRequestPush = z.infer<typeof channelRequestPushSchema>;
export type ReminderListPayload = z.infer<typeof reminderListPayloadSchema>;
export type ReminderPayload = z.infer<typeof reminderPayloadSchema>;
export type RemindersSyncPush = z.infer<typeof remindersSyncPushSchema>;
export type CalendarPayload = z.infer<typeof calendarPayloadSchema>;
export type CalendarEventPayload = z.infer<typeof calendarEventPayloadSchema>;
export type CalendarSyncPush = z.infer<typeof calendarSyncPushSchema>;
export type DataPush = z.infer<typeof dataPushSchema>;
