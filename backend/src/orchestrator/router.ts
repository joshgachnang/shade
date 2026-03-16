import {logger} from "@terreno/api";
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
  const groupName = group.name;

  logger.debug(`Building prompt for group ${groupName}, trigger from ${triggeringMessage.sender}`);

  // Always fetch the last 10 messages in the channel for context (regardless of processed state)
  let recentMessages: MessageDocument[];
  try {
    recentMessages = await Message.find({groupId: group._id}).sort({created: -1}).limit(10);
    recentMessages.reverse(); // Sort chronologically
  } catch (err) {
    logger.error(`Failed to fetch recent messages for group ${groupName}: ${err}`);
    throw err;
  }

  // Also fetch any unprocessed messages that may fall outside the last 10
  let unprocessedMessages: MessageDocument[];
  try {
    unprocessedMessages = await Message.find({
      groupId: group._id,
      processedAt: {$exists: false},
      isFromBot: false,
    }).sort({created: 1});
  } catch (err) {
    logger.error(`Failed to fetch unprocessed messages for group ${groupName}: ${err}`);
    throw err;
  }

  // Merge and deduplicate: combine recent context with any unprocessed messages
  const messageMap = new Map<string, MessageDocument>();
  for (const msg of recentMessages) {
    messageMap.set(msg._id.toString(), msg);
  }
  for (const msg of unprocessedMessages) {
    messageMap.set(msg._id.toString(), msg);
  }

  // Sort chronologically
  let contextMessages = Array.from(messageMap.values()).sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
  );

  // Limit to last 50 messages for context
  if (contextMessages.length > 50) {
    contextMessages = contextMessages.slice(-50);
  }

  logger.debug(
    `Prompt context for group ${groupName}: ${contextMessages.length} messages (${recentMessages.length} recent, ${unprocessedMessages.length} unprocessed)`
  );

  const xmlConversation = formatMessagesAsXml(contextMessages, assistantName);
  const messageIds = contextMessages.map((m) => m._id.toString());

  const prompt = [
    `You are ${assistantName}, responding in a group chat called "${group.name}".`,
    "",
    "Here is the recent conversation (last 10 messages plus any unprocessed messages):",
    xmlConversation,
    "",
    `The latest message requiring your response is from ${triggeringMessage.sender}:`,
    triggeringMessage.content,
    "",
    "Respond naturally and helpfully. Keep responses concise unless detail is needed.",
    "If you need more conversation history for context, use the get_channel_history tool.",
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
