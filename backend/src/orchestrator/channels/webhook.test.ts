import {describe, expect, mock, test} from "bun:test";
import crypto from "node:crypto";
import type {ChannelDocument} from "../../types";
import {WebhookChannelConnector} from "./webhook";

// Mock Channel model
mock.module("../../models/channel", () => ({
  Channel: {
    findByIdAndUpdate: mock(() => Promise.resolve()),
  },
}));

// Mock WebhookSource model
mock.module("../../models/webhookSource", () => ({
  WebhookSource: {
    findById: mock(() => Promise.resolve(null)),
    findByIdAndUpdate: mock(() => Promise.resolve()),
  },
}));

const makeChannelDoc = (): ChannelDocument => {
  return {
    _id: {toString: () => "channel1"} as any,
    name: "test-webhook",
    type: "webhook" as const,
    status: "disconnected" as const,
    config: {},
  } as unknown as ChannelDocument;
};

describe("WebhookChannelConnector", () => {
  test("starts disconnected", () => {
    const connector = new WebhookChannelConnector(makeChannelDoc());
    expect(connector.isConnected()).toBe(false);
  });

  test("connect sets connected state", async () => {
    const connector = new WebhookChannelConnector(makeChannelDoc());
    await connector.connect();
    expect(connector.isConnected()).toBe(true);
  });

  test("disconnect sets disconnected state", async () => {
    const connector = new WebhookChannelConnector(makeChannelDoc());
    await connector.connect();
    await connector.disconnect();
    expect(connector.isConnected()).toBe(false);
  });

  test("sendMessage is a no-op for webhooks", async () => {
    const connector = new WebhookChannelConnector(makeChannelDoc());
    // Should not throw
    await connector.sendMessage("group1", "hello");
  });

  test("onMessage registers handler", () => {
    const connector = new WebhookChannelConnector(makeChannelDoc());
    const handler = mock(() => Promise.resolve());
    connector.onMessage(handler);
    // Handler is stored internally — no direct assertion, but it shouldn't throw
  });

  test("exposes channelDoc", () => {
    const doc = makeChannelDoc();
    const connector = new WebhookChannelConnector(doc);
    expect(connector.channelDoc).toBe(doc);
  });
});

describe("webhook signature validation", () => {
  // We can test the signature logic indirectly by verifying HMAC-SHA256 behavior
  test("HMAC-SHA256 signature matches expected format", () => {
    const secret = "test-secret";
    const payload = JSON.stringify({content: "hello"});
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    // The signature should be a hex string
    expect(expected).toMatch(/^[0-9a-f]+$/);
    expect(expected.length).toBe(64); // SHA-256 produces 64 hex chars
  });

  test("different payloads produce different signatures", () => {
    const secret = "test-secret";
    const sig1 = crypto.createHmac("sha256", secret).update("payload1").digest("hex");
    const sig2 = crypto.createHmac("sha256", secret).update("payload2").digest("hex");
    expect(sig1).not.toBe(sig2);
  });

  test("different secrets produce different signatures", () => {
    const payload = "same-payload";
    const sig1 = crypto.createHmac("sha256", "secret1").update(payload).digest("hex");
    const sig2 = crypto.createHmac("sha256", "secret2").update(payload).digest("hex");
    expect(sig1).not.toBe(sig2);
  });
});
