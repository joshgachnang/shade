import {z} from "zod";
import {commandResultSchema} from "./commands";

export const heartbeatRequestSchema = z.object({
  status: z.enum(["healthy", "degraded", "error"]),
  platform: z.string().optional(),
  arch: z.string().optional(),
  version: z.string().optional(),
  hostname: z.string().optional(),
  uptime: z.number().optional(), // seconds
  memoryUsage: z.number().optional(), // bytes
  commandResults: z.array(commandResultSchema).default([]),
});

export const heartbeatResponseSchema = z.object({
  status: z.string(), // agent's current status in Shade
  commands: z.array(
    z.object({
      commandId: z.string(),
      type: z.string(),
      payload: z.record(z.string(), z.unknown()).default({}),
    })
  ),
});

export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
