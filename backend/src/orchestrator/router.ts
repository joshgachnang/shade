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

const CONVERSATION_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

export const buildPromptForGroup = async (
  group: GroupDocument,
  triggeringMessage: MessageDocument
): Promise<FormattedPrompt> => {
  const assistantName = config.assistantName;
  const windowStart = new Date(Date.now() - CONVERSATION_WINDOW_MS);

  // Get all messages (user + bot) from the last 4 hours for conversation context
  const conversationMessages = await Message.find({
    groupId: group._id,
    created: {$gte: windowStart},
  })
    .sort({created: 1})
    .limit(100);

  // Also get any unprocessed messages that might be older than 4h (edge case)
  const unprocessedMessages = await Message.find({
    groupId: group._id,
    processedAt: {$exists: false},
    isFromBot: false,
  }).sort({created: 1});

  // Merge: use conversation window as base, add any unprocessed not already included
  const seenIds = new Set(conversationMessages.map((m) => m._id.toString()));
  const allMessages = [...conversationMessages];
  for (const msg of unprocessedMessages) {
    if (!seenIds.has(msg._id.toString())) {
      allMessages.push(msg);
    }
  }
  allMessages.sort((a, b) => a.created.getTime() - b.created.getTime());

  // Cap at 100 messages, keep the most recent
  const contextMessages = allMessages.length > 100 ? allMessages.slice(-100) : allMessages;

  // Track which unprocessed messages are included (for marking as processed later)
  const messageIds = contextMessages.filter((m) => !m.isFromBot).map((m) => m._id.toString());

  const xmlConversation = formatMessagesAsXml(contextMessages, assistantName);

  const prompt = [
    `You are ${assistantName}, responding in a group chat called "${group.name}".`,
    "",
    "Here is the conversation from the last few hours:",
    xmlConversation,
    "",
    `The latest message requiring your response is from ${triggeringMessage.sender}:`,
    triggeringMessage.content,
    "",
    "Respond naturally and helpfully. Keep responses concise unless detail is needed.",
    "You have context from the conversation above — reference it when relevant.",
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
