import type {Server} from "node:http";
import {signupUser} from "@terreno/api";
import mongoose from "mongoose";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {User} from "../models/user";
import {start} from "../server";
import type {ChannelDocument, GroupDocument, UserDocument} from "../types";

export const TEST_PASSWORD = "TestPassword123!";
export const ADMIN_EMAIL = "admin@shade-test.com";
export const USER_EMAIL = "user@shade-test.com";

export interface TestData {
  admin: UserDocument;
  user: UserDocument;
  channel: ChannelDocument;
  group: GroupDocument;
}

let serverInstance: Server | null = null;
let serverPort: number | null = null;

/**
 * Clears all collections in the test database.
 */
export const clearDatabase = async (): Promise<void> => {
  const collections = Object.keys(mongoose.connection.collections);
  await Promise.all(
    collections.map((name) => mongoose.connection.collections[name].deleteMany({}))
  );
};

/**
 * Creates seed data: an admin user, a regular user, a test channel, and a test group.
 */
export const setupTestData = async (): Promise<TestData> => {
  await clearDatabase();

  const [admin, user] = await Promise.all([
    signupUser(User as any, ADMIN_EMAIL, TEST_PASSWORD, {name: "Admin", admin: true}),
    signupUser(User as any, USER_EMAIL, TEST_PASSWORD, {name: "Test User", admin: false}),
  ]);

  const channel = await Channel.create({
    name: "test-channel",
    type: "webhook",
    status: "connected",
    config: {},
  });

  const group = await Group.create({
    name: "test-group",
    folder: "test-group",
    channelId: channel._id,
    externalId: "test-ext-id",
    trigger: "@Shade",
    requiresTrigger: true,
    isMain: true,
  });

  return {
    admin: admin as unknown as UserDocument,
    user: user as unknown as UserDocument,
    channel: channel as unknown as ChannelDocument,
    group: group as unknown as GroupDocument,
  };
};

/**
 * Starts the Express app on a random port and returns the base URL.
 * Reuses an existing server if one is already running.
 */
export const setupTestServer = async (): Promise<{baseUrl: string; testData: TestData}> => {
  const testData = await setupTestData();

  if (serverInstance && serverPort) {
    return {baseUrl: `http://127.0.0.1:${serverPort}`, testData};
  }

  const app = await start(true /* skipListen */);

  // Listen on port 0 to let the OS pick an available port
  serverInstance = app.listen(0);
  const addr = serverInstance.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to get server address");
  }
  serverPort = addr.port;

  return {baseUrl: `http://127.0.0.1:${serverPort}`, testData};
};

/**
 * Stops the test server.
 */
export const stopTestServer = async (): Promise<void> => {
  if (serverInstance) {
    await new Promise<void>((resolve, reject) => {
      serverInstance!.close((err) => (err ? reject(err) : resolve()));
    });
    serverInstance = null;
    serverPort = null;
  }
};

/**
 * Logs in as a user and returns the auth token.
 */
export const loginAsUser = async (
  baseUrl: string,
  email: string,
  password: string = TEST_PASSWORD
): Promise<string> => {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({email, password}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const body = (await res.json()) as {data: {token: string}};
  return body.data.token;
};

/**
 * Sends a command via the /command endpoint, just like sending a Slack message.
 */
export const sendCommand = async (
  baseUrl: string,
  token: string,
  content: string,
  options: {groupId?: string; groupName?: string} = {}
): Promise<{messageId: string; groupId: string; groupName: string}> => {
  const res = await fetch(`${baseUrl}/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({content, ...options}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Command failed (${res.status}): ${body}`);
  }

  const body = (await res.json()) as {
    data: {messageId: string; groupId: string; groupName: string};
  };
  return body.data;
};

/**
 * Gets messages for a group, sorted oldest-first.
 */
export const getGroupMessages = async (groupId: string) => {
  return Message.find({groupId}).sort({created: 1});
};

/**
 * Waits for a condition to become true, polling at interval.
 */
export const waitFor = async (
  fn: () => Promise<boolean>,
  {timeoutMs = 10000, intervalMs = 200} = {}
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
};
