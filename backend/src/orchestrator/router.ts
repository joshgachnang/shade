import {config} from "../config";
import {Message} from "../models/message";
import type {GroupDocument, MessageDocument} from "../types";

export interface FormattedPrompt {
  prompt: string;
  messageIds: string[];
}

const escapeXml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

export const matchesTrigger = (content: string, trigger: string): boolean => {
  const pattern = new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return pattern.test(content);
};

export const formatMessagesAsXml = (messages: MessageDocument[], assistantName: string): string => {
  const lines: string[] = ["<conversation>"];

  for (const msg of messages) {
    const role = msg.isFromBot ? "assistant" : "user";
    const sender = msg.isFromBot ? assistantName : msg.sender;
    lines.push(`  <message role="${role}" sender="${escapeXml(sender)}">`);
    lines.push(`    ${escapeXml(msg.content)}`);
    lines.push("  </message>");
  }

  lines.push("</conversation>");
  return lines.join("\n");
};

export const buildPromptForGroup = async (
  group: GroupDocument,
  triggeringMessage: MessageDocument
): Promise<FormattedPrompt> => {
  const assistantName = config.assistantName;

  // Gather context: messages since last bot response or last 20 messages
  const recentMessages = await Message.find({
    groupId: group._id,
    processedAt: {$exists: false},
  })
    .sort({created: 1})
    .limit(50);

  // Find the last bot message for context boundary
  const lastBotMessage = await Message.findOne({
    groupId: group._id,
    isFromBot: true,
  }).sort({created: -1});

  // Get messages since last bot response (catch-up)
  let contextMessages: MessageDocument[];
  if (lastBotMessage) {
    contextMessages = await Message.find({
      groupId: group._id,
      created: {$gt: lastBotMessage.created},
    }).sort({created: 1});
  } else {
    contextMessages = recentMessages;
  }

  // Limit to last 50 messages for context
  if (contextMessages.length > 50) {
    contextMessages = contextMessages.slice(-50);
  }

  const xmlConversation = formatMessagesAsXml(contextMessages, assistantName);
  const messageIds = contextMessages.map((m) => m._id.toString());

  const prompt = [
    `You are ${assistantName}, responding in a group chat called "${group.name}".`,
    "",
    "Here is the recent conversation:",
    xmlConversation,
    "",
    `The latest message requiring your response is from ${triggeringMessage.sender}:`,
    triggeringMessage.content,
    "",
    "Respond naturally and helpfully. Keep responses concise unless detail is needed.",
  ].join("\n");

  return {prompt, messageIds};
};

export const formatOutboundMessage = (response: string, _assistantName: string): string => {
  // Strip <internal> tags from response
  let formatted = response.replace(/<internal>[\s\S]*?<\/internal>/g, "");

  // Trim whitespace
  formatted = formatted.trim();

  return formatted;
};

export const shouldTrigger = (content: string, group: GroupDocument): boolean => {
  if (!group.requiresTrigger) {
    return true;
  }

  return matchesTrigger(content, group.trigger);
};
