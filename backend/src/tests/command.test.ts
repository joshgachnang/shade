import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {Message} from "../models/message";
import type {TestData} from "./testHelper";
import {
  ADMIN_EMAIL,
  getGroupMessages,
  loginAsUser,
  sendCommand,
  setupTestServer,
  stopTestServer,
  USER_EMAIL,
} from "./testHelper";

let baseUrl: string;
let testData: TestData;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  const setup = await setupTestServer();
  baseUrl = setup.baseUrl;
  testData = setup.testData;

  adminToken = await loginAsUser(baseUrl, ADMIN_EMAIL);
  userToken = await loginAsUser(baseUrl, USER_EMAIL);
}, 30000);

afterAll(async () => {
  await stopTestServer();
});

describe("POST /command", () => {
  test("rejects unauthenticated requests", async () => {
    const res = await fetch(`${baseUrl}/command`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({content: "@Shade hello"}),
    });
    expect(res.status).toBe(401);
  });

  test("rejects empty content", async () => {
    const res = await fetch(`${baseUrl}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({content: ""}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing content", async () => {
    const res = await fetch(`${baseUrl}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("creates a message as authenticated user", async () => {
    const result = await sendCommand(baseUrl, userToken, "@Shade hello world");

    expect(result.messageId).toBeDefined();
    expect(result.groupId).toBe(testData.group._id.toString());
    expect(result.groupName).toBe("test-group");

    // Verify message was stored in the database
    const message = await Message.findById(result.messageId);
    expect(message).not.toBeNull();
    expect(message!.content).toBe("@Shade hello world");
    expect(message!.sender).toBe("Test User");
    expect(message!.isFromBot).toBe(false);
    expect(message!.groupId.toString()).toBe(testData.group._id.toString());
    expect(message!.channelId.toString()).toBe(testData.channel._id.toString());
    expect((message!.metadata as any).source).toBe("command-api");
  });

  test("creates a message as admin", async () => {
    const result = await sendCommand(baseUrl, adminToken, "@Shade admin command");

    const message = await Message.findById(result.messageId);
    expect(message).not.toBeNull();
    expect(message!.sender).toBe("Admin");
  });

  test("targets group by name", async () => {
    const result = await sendCommand(baseUrl, userToken, "@Shade targeted", {
      groupName: "test-group",
    });
    expect(result.groupName).toBe("test-group");
  });

  test("targets group by id", async () => {
    const result = await sendCommand(baseUrl, userToken, "@Shade by-id", {
      groupId: testData.group._id.toString(),
    });
    expect(result.groupId).toBe(testData.group._id.toString());
  });

  test("returns 404 for non-existent group", async () => {
    const res = await fetch(`${baseUrl}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({content: "@Shade test", groupName: "nonexistent-group"}),
    });
    expect(res.status).toBe(404);
  });

  test("message appears in group messages list", async () => {
    // Clear existing messages first
    await Message.deleteMany({groupId: testData.group._id});

    await sendCommand(baseUrl, userToken, "@Shade message one");
    await sendCommand(baseUrl, userToken, "@Shade message two");

    const messages = await getGroupMessages(testData.group._id.toString());
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe("@Shade message one");
    expect(messages[1].content).toBe("@Shade message two");
  });

  test("message is not marked as processed", async () => {
    const result = await sendCommand(baseUrl, userToken, "@Shade unprocessed");
    const message = await Message.findById(result.messageId);
    expect(message!.processedAt).toBeUndefined();
  });
});
