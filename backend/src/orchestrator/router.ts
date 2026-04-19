import {logger} from "@terreno/api";
import {loadAppConfig} from "../models/appConfig";
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

const MAX_CONTEXT_MESSAGES = 100;

/**
 * System prompt template. `{assistantName}` and `{groupName}` are substituted
 * at render time. Kept at module scope so it's easy to edit without scanning
 * `buildPromptForGroup`.
 */
const PROMPT_TEMPLATE = [
  `You are {assistantName}, responding in a group chat called "{groupName}".`,
  "",
  "Here is the conversation from the last few hours:",
  "{conversation}",
  "",
  `The latest message requiring your response is from {sender}:`,
  "{triggerContent}",
  "",
  "Respond naturally and helpfully. Keep responses concise unless detail is needed.",
  "You have context from the conversation above — reference it when relevant.",
  "If you need more conversation history for context, use the get_channel_history tool.",
].join("\n");

/**
 * Fetch the conversation context: every message in the time window, plus any
 * unprocessed user messages that fall outside it. One `$or` + sort + limit
 * query instead of the previous two-query merge. Results are sorted ascending
 * and capped at `MAX_CONTEXT_MESSAGES` (keeping the most recent).
 */
const fetchContextMessages = async (
  groupId: GroupDocument["_id"],
  windowStart: Date
): Promise<{contextMessages: MessageDocument[]; windowCount: number; unprocessedCount: number}> => {
  const messages = await Message.find({
    groupId,
    $or: [{created: {$gte: windowStart}}, {processedAt: {$exists: false}, isFromBot: false}],
  })
    .sort({created: 1})
    .limit(MAX_CONTEXT_MESSAGES * 2);

  let windowCount = 0;
  let unprocessedCount = 0;
  for (const msg of messages) {
    const inWindow = msg.created >= windowStart;
    if (inWindow) {
      windowCount++;
    }
    if (!inWindow && !msg.isFromBot && !msg.processedAt) {
      unprocessedCount++;
    }
  }

  const contextMessages =
    messages.length > MAX_CONTEXT_MESSAGES ? messages.slice(-MAX_CONTEXT_MESSAGES) : messages;

  return {contextMessages, windowCount, unprocessedCount};
};

const renderPrompt = (args: {
  assistantName: string;
  group: GroupDocument;
  triggeringMessage: MessageDocument;
  conversationXml: string;
}): string => {
  return PROMPT_TEMPLATE.replace("{assistantName}", args.assistantName)
    .replace("{groupName}", args.group.name)
    .replace("{conversation}", args.conversationXml)
    .replace("{sender}", args.triggeringMessage.sender)
    .replace("{triggerContent}", args.triggeringMessage.content);
};

export const buildPromptForGroup = async (
  group: GroupDocument,
  triggeringMessage: MessageDocument
): Promise<FormattedPrompt> => {
  const appConfig = await loadAppConfig();
  const {assistantName} = appConfig;
  const windowStart = new Date(Date.now() - appConfig.orchestrator.conversationWindowMs);

  logger.debug(`Building prompt for group ${group.name}, trigger from ${triggeringMessage.sender}`);

  const {contextMessages, windowCount, unprocessedCount} = await fetchContextMessages(
    group._id,
    windowStart
  );

  const messageIds = contextMessages.filter((m) => !m.isFromBot).map((m) => m._id.toString());

  logger.debug(
    `Prompt context for group ${group.name}: ${contextMessages.length} messages ` +
      `(${windowCount} from window, ${unprocessedCount} unprocessed)`
  );

  const conversationXml = formatMessagesAsXml(contextMessages, assistantName);
  const prompt = renderPrompt({assistantName, group, triggeringMessage, conversationXml});

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
