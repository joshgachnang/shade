import type {Server} from "node:http";
import {signupUser} from "@terreno/api";
import mongoose from "mongoose";
import {Channel} from "../models/channel";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {User} from "../models/user";
import {start} from "../server";
import {TEST_ADMIN_EMAIL, TEST_PASSWORD, TEST_USER_EMAIL} from "../testMode/constants";
import type {ChannelDocument, GroupDocument, UserDocument} from "../types";

// Re-exported so existing tests keep importing from testHelper; the values
// live in testMode/constants.ts so the boot seed uses the same identity.
export {TEST_PASSWORD};
export const ADMIN_EMAIL = TEST_ADMIN_EMAIL;
export const USER_EMAIL = TEST_USER_EMAIL;

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
    type: "test",
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
 * Gets messages for a group, sorted oldest-first.
 */
export const getGroupMessages = async (groupId: string) => {
  return Message.find({groupId}).sort({created: 1});
};

export {
  getOutbox,
  loginAsUser,
  type OutboxEntry,
  resetHarness,
  sendCommand,
  tickHarness,
  waitFor,
} from "./harnessClient";
