import {z} from "zod";

export const registrationRequestSchema = z.object({
  name: z.string().min(1).max(100),
  agentType: z.string().min(1), // "imessage", "calendar", "contacts", "email"
  platform: z.enum(["darwin", "linux", "windows"]),
  arch: z.string().min(1), // "arm64", "x64"
  version: z.string().min(1),
  hostname: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
});

export const registrationResponseSchema = z.object({
  agentId: z.string(),
  token: z.string(),
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;
export type RegistrationResponse = z.infer<typeof registrationResponseSchema>;
