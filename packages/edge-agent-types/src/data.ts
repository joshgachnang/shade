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

export const dataPushSchema = z.discriminatedUnion("type", [
  messagesDataPushSchema,
  channelRequestPushSchema,
  eventsDataPushSchema,
]);

export type MessagePayload = z.infer<typeof messagePayloadSchema>;
export type MessagesDataPush = z.infer<typeof messagesDataPushSchema>;
export type ChannelRequestPush = z.infer<typeof channelRequestPushSchema>;
export type DataPush = z.infer<typeof dataPushSchema>;
