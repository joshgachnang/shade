import {describe, expect, mock, test} from "bun:test";
import type {ChannelDocument} from "../../types";
import {EdgeAgentChannelConnector} from "./edgeAgent";

// Mock EdgeAgent model
const mockFindOne = mock(() => Promise.resolve({_id: "agent1", name: "test-agent"}));
const mockFindByIdAndUpdate = mock(() => Promise.resolve());

mock.module("../../models/edgeAgent", () => ({
  EdgeAgent: {
    findOne: mockFindOne,
    findByIdAndUpdate: mockFindByIdAndUpdate,
  },
}));

const makeChannelDoc = (): ChannelDocument => {
  return {
    _id: {toString: () => "channel1"} as any,
    name: "test-edge-channel",
    type: "imessage" as const,
    status: "connected" as const,
    config: {},
  } as unknown as ChannelDocument;
};

describe("EdgeAgentChannelConnector", () => {
  test("starts disconnected", () => {
    const connector = new EdgeAgentChannelConnector(makeChannelDoc());
    expect(connector.isConnected()).toBe(false);
  });

  test("connect sets connected state", async () => {
    const connector = new EdgeAgentChannelConnector(makeChannelDoc());
    await connector.connect();
    expect(connector.isConnected()).toBe(true);
  });

  test("disconnect sets disconnected state", async () => {
    const connector = new EdgeAgentChannelConnector(makeChannelDoc());
    await connector.connect();
    await connector.disconnect();
    expect(connector.isConnected()).toBe(false);
  });

  test("sendMessage queues a command on the edge agent", async () => {
    const connector = new EdgeAgentChannelConnector(makeChannelDoc());
    await connector.sendMessage("chat123", "Hello world");

    expect(mockFindOne).toHaveBeenCalledWith({channelId: expect.anything()});
    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      "agent1",
      expect.objectContaining({
        $push: {
          pendingCommands: expect.objectContaining({
            type: "send_message",
            payload: {to: "chat123", text: "Hello world"},
          }),
        },
      })
    );
  });

  test("onMessage is a no-op", () => {
    const connector = new EdgeAgentChannelConnector(makeChannelDoc());
    // Should not throw
    connector.onMessage(async () => {});
  });

  test("createChannel throws", async () => {
    const connector = new EdgeAgentChannelConnector(makeChannelDoc());
    await expect(connector.createChannel("test")).rejects.toThrow();
  });
});
