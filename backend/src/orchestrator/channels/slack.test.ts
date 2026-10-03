import {describe, expect, test} from "bun:test";
import type {ChannelDocument} from "../../types";
import {SlackChannelConnector} from "./slack";

const slackError = (error: string) => Object.assign(new Error(error), {data: {error}});

// The Web API client is the external boundary; everything else is the real connector.
const connectorWith = (conversations: Record<string, (args: any) => Promise<unknown>>) => {
  const connector = new SlackChannelConnector({
    _id: {toString: () => "channel1"},
    name: "test-slack",
    type: "slack",
    status: "disconnected",
    config: {botToken: "xoxb-test"},
  } as unknown as ChannelDocument);
  (connector as unknown as {app: unknown}).app = {client: {conversations}};
  return connector;
};

describe("SlackChannelConnector feature channels", () => {
  test("createChannel adopts an open channel that already has the name", async () => {
    const listed: unknown[] = [];
    const connector = connectorWith({
      create: async () => {
        throw slackError("name_taken");
      },
      list: async (args) => {
        listed.push(args);
        return args.cursor
          ? {channels: [{id: "C2", name: "feat-example"}], response_metadata: {next_cursor: ""}}
          : {channels: [{id: "C1", name: "other"}], response_metadata: {next_cursor: "page2"}};
      },
    });
    expect(await connector.createChannel("feat-example")).toEqual({id: "C2"});
    expect(listed).toHaveLength(2);
  });

  test("createChannel still fails when the taken name is not an open channel", async () => {
    const connector = connectorWith({
      create: async () => {
        throw slackError("name_taken");
      },
      list: async () => ({channels: [], response_metadata: {next_cursor: ""}}),
    });
    await expect(connector.createChannel("feat-example")).rejects.toThrow("name_taken");
  });

  test("inviting someone already in the channel is a no-op", async () => {
    const connector = connectorWith({
      invite: async () => {
        throw slackError("already_in_channel");
      },
    });
    await connector.inviteToChannel("C2", "U1");
    const failing = connectorWith({
      invite: async () => {
        throw slackError("channel_not_found");
      },
    });
    await expect(failing.inviteToChannel("C2", "U1")).rejects.toThrow("channel_not_found");
  });
});
