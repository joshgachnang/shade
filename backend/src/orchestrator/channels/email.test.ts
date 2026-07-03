import {afterEach, describe, expect, mock, test} from "bun:test";
import {simpleParser} from "mailparser";
import mongoose from "mongoose";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import type {ChannelDocument} from "../../types";
import {buildInboundEmailMessage, EmailChannelConnector} from "./email";

const createdGroupIds: mongoose.Types.ObjectId[] = [];

const makeGroup = async (
  channelId: mongoose.Types.ObjectId,
  externalId: string,
  overrides: Record<string, unknown> = {}
) => {
  const group = await Group.create({
    name: "Email Test Group",
    folder: `email-test-${new mongoose.Types.ObjectId().toString()}`,
    channelId,
    externalId,
    ...overrides,
  });
  createdGroupIds.push(group._id);
  return group;
};

const makeInboundMessage = async (
  groupId: mongoose.Types.ObjectId,
  channelId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>,
  overrides: Record<string, unknown> = {}
) => {
  return Message.create({
    groupId,
    channelId,
    externalId: `ext-${new mongoose.Types.ObjectId().toString()}`,
    sender: "Test Sender",
    senderExternalId: "sender@example.com",
    content: "inbound content",
    isFromBot: false,
    metadata,
    ...overrides,
  });
};

const makeConnector = (channelId: mongoose.Types.ObjectId) => {
  const channelDoc = {
    _id: channelId,
    name: "test-email",
    type: "email",
    status: "disconnected",
    config: {
      imapHost: "imap.example.com",
      imapPort: 993,
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      user: "shade@example.com",
      password: "secret",
    },
  } as unknown as ChannelDocument;

  const connector = new EmailChannelConnector(channelDoc);
  const sendMail = mock((_mailOptions: Record<string, unknown>) =>
    Promise.resolve({messageId: "<outbound@example.com>"})
  );
  (connector as unknown as {smtpTransport: {sendMail: typeof sendMail}}).smtpTransport = {
    sendMail,
  };
  return {connector, sendMail};
};

const RAW_EMAIL = [
  "Message-ID: <msg-2@example.com>",
  "In-Reply-To: <msg-1@example.com>",
  "References: <root@example.com> <msg-1@example.com>",
  "From: Alice Example <alice@example.com>",
  "To: shade@example.com",
  "Subject: Hello Shade",
  "Date: Tue, 30 Jun 2026 12:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi there, Shade!",
].join("\r\n");

afterEach(async () => {
  if (createdGroupIds.length > 0) {
    await Message.deleteMany({groupId: {$in: createdGroupIds}});
    await Group.deleteMany({_id: {$in: createdGroupIds}});
    createdGroupIds.length = 0;
  }
});

describe("EmailChannelConnector inbound metadata", () => {
  test("parsed inbound mail produces a Message with emailMessageId, from, subject, and references", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const group = await makeGroup(channelId, "<root@example.com>");

    const parsed = await simpleParser(RAW_EMAIL);
    const inbound = buildInboundEmailMessage(parsed, 42);

    // Persist the way ChannelManager.handleInboundMessage does.
    const message = await Message.create({
      groupId: group._id,
      channelId,
      externalId: inbound.externalId,
      sender: inbound.sender,
      senderExternalId: inbound.senderExternalId,
      content: inbound.content,
      isFromBot: false,
      metadata: inbound.metadata,
    });

    const reloaded = await Message.findExactlyOne({_id: message._id});
    const metadata = reloaded.metadata as Record<string, unknown>;
    expect(metadata.emailMessageId).toBe("<msg-2@example.com>");
    expect(metadata.from).toBe("alice@example.com");
    expect(metadata.subject).toBe("Hello Shade");
    expect(metadata.references).toEqual(["<root@example.com>", "<msg-1@example.com>"]);
  });

  test("groups messages by thread root and captures sender and content", async () => {
    const parsed = await simpleParser(RAW_EMAIL);
    const inbound = buildInboundEmailMessage(parsed, 7);

    expect(inbound.groupExternalId).toBe("<root@example.com>");
    expect(inbound.externalId).toBe("<msg-2@example.com>");
    expect(inbound.senderExternalId).toBe("alice@example.com");
    expect(inbound.content).toBe("Hi there, Shade!");
  });

  test("a new thread stores its own message ID and empty references", async () => {
    const raw = [
      "Message-ID: <fresh@example.com>",
      "From: Bob <bob@example.com>",
      "To: shade@example.com",
      "Subject: New conversation",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "First contact",
    ].join("\r\n");

    const parsed = await simpleParser(raw);
    const inbound = buildInboundEmailMessage(parsed, 8);
    const metadata = inbound.metadata as Record<string, unknown>;

    expect(metadata.emailMessageId).toBe("<fresh@example.com>");
    expect(metadata.from).toBe("bob@example.com");
    expect(metadata.subject).toBe("New conversation");
    expect(metadata.references).toEqual([]);
  });
});

describe("EmailChannelConnector sendMessage threading", () => {
  test("reply targets the most recent inbound email with threaded headers", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const group = await makeGroup(channelId, "<root@example.com>");
    const {connector, sendMail} = makeConnector(channelId);

    await makeInboundMessage(group._id, channelId, {
      emailMessageId: "<msg-1@example.com>",
      from: "bob@example.com",
      subject: "Hello Shade",
      references: ["<root@example.com>"],
    });
    await makeInboundMessage(group._id, channelId, {
      emailMessageId: "<msg-2@example.com>",
      from: "alice@example.com",
      subject: "Hello Shade",
      references: ["<root@example.com>", "<msg-1@example.com>"],
    });

    await connector.sendMessage("<root@example.com>", "Here is my reply");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.from).toBe("shade@example.com");
    expect(mailArgs.to).toBe("alice@example.com");
    expect(mailArgs.inReplyTo).toBe("<msg-2@example.com>");
    expect(mailArgs.references).toEqual([
      "<root@example.com>",
      "<msg-1@example.com>",
      "<msg-2@example.com>",
    ]);
    expect(mailArgs.subject).toBe("Re: Hello Shade");
    expect(mailArgs.text).toBe("Here is my reply");
  });

  test("does not double-prefix a subject that already starts with Re:", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const group = await makeGroup(channelId, "<root@example.com>");
    const {connector, sendMail} = makeConnector(channelId);

    await makeInboundMessage(group._id, channelId, {
      emailMessageId: "<msg-3@example.com>",
      from: "alice@example.com",
      subject: "RE: Hello Shade",
      references: ["<root@example.com>"],
    });

    await connector.sendMessage("<root@example.com>", "Another reply");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.subject).toBe("RE: Hello Shade");
  });

  test("ignores bot messages when resolving the thread target", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const group = await makeGroup(channelId, "<root@example.com>");
    const {connector, sendMail} = makeConnector(channelId);

    await makeInboundMessage(group._id, channelId, {
      emailMessageId: "<human@example.com>",
      from: "alice@example.com",
      subject: "Hello Shade",
      references: [],
    });
    // A newer outbound bot message must not become the reply target.
    await makeInboundMessage(
      group._id,
      channelId,
      {
        emailMessageId: "<bot@example.com>",
        from: "shade@example.com",
        subject: "Hello Shade",
        references: [],
      },
      {isFromBot: true, sender: "Shade"}
    );

    await connector.sendMessage("<root@example.com>", "Reply to the human");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.to).toBe("alice@example.com");
    expect(mailArgs.inReplyTo).toBe("<human@example.com>");
  });

  test("handles string references stored on the inbound message", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const group = await makeGroup(channelId, "<root@example.com>");
    const {connector, sendMail} = makeConnector(channelId);

    await makeInboundMessage(group._id, channelId, {
      emailMessageId: "<msg-4@example.com>",
      from: "alice@example.com",
      subject: "Hello Shade",
      references: "<root@example.com>",
    });

    await connector.sendMessage("<root@example.com>", "Reply");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.references).toEqual(["<root@example.com>", "<msg-4@example.com>"]);
  });
});

describe("EmailChannelConnector sendMessage fallback", () => {
  test("falls back to direct send when the group has no inbound email metadata", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const group = await makeGroup(channelId, "someone@example.com");
    // A message without emailMessageId (e.g. pre-existing data) is not a thread target.
    await makeInboundMessage(group._id, channelId, {subject: "no threading info"});
    const {connector, sendMail} = makeConnector(channelId);

    await connector.sendMessage("someone@example.com", "Scheduled update");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.from).toBe("shade@example.com");
    expect(mailArgs.to).toBe("someone@example.com");
    expect(mailArgs.text).toBe("Scheduled update");
    expect(mailArgs.inReplyTo).toBeUndefined();
    expect(mailArgs.references).toBeUndefined();
    expect(mailArgs.subject).toBeUndefined();
  });

  test("falls back to direct send when no group exists for the external ID", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const {connector, sendMail} = makeConnector(channelId);

    await connector.sendMessage("direct@example.com", "Hello");

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = sendMail.mock.calls[0][0];
    expect(mailArgs.to).toBe("direct@example.com");
    expect(mailArgs.inReplyTo).toBeUndefined();
  });

  test("skips send when no thread target exists and external ID is not an address", async () => {
    const channelId = new mongoose.Types.ObjectId();
    await makeGroup(channelId, "<thread-only@example.com>");
    const {connector, sendMail} = makeConnector(channelId);

    await connector.sendMessage("<thread-only@example.com>", "No recipient available");

    expect(sendMail).not.toHaveBeenCalled();
  });

  test("throws when the SMTP transport is not initialized", async () => {
    const channelId = new mongoose.Types.ObjectId();
    const {connector} = makeConnector(channelId);
    (connector as unknown as {smtpTransport: null}).smtpTransport = null;

    await expect(connector.sendMessage("direct@example.com", "Hello")).rejects.toThrow(
      "SMTP transport not initialized"
    );
  });
});
