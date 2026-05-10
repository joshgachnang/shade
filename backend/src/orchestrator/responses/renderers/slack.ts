import type {
  Block,
  ContextBlock,
  DividerBlock,
  ImageBlock,
  KnownBlock,
  MrkdwnElement,
  PlainTextElement,
  SectionBlock,
} from "@slack/types";
import type {Action, Card, RichResponse} from "../schema";
import {
  type CardRenderer,
  type ChannelType,
  placeholderActionId,
  type SlackRenderResult,
} from "./types";

const SLACK_MAX_BLOCKS = 50;

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const mrkdwn = (text: string, max = 3000): MrkdwnElement => ({
  type: "mrkdwn",
  text: truncate(text, max),
});

const plainText = (text: string, max = 150): PlainTextElement => ({
  type: "plain_text",
  text: truncate(text, max),
});

const buttonStyleToSlack = (style: Action["style"]): "primary" | "danger" | undefined => {
  if (style === "primary") return "primary";
  if (style === "danger") return "danger";
  return undefined;
};

/**
 * Render an Action[] as a Slack actions block. URL-typed actions become
 * url-buttons that do NOT round-trip to Shade; non-URL actions become regular
 * buttons with placeholder-namespaced action_ids that SlackConnector will
 * substitute at send time.
 */
const actionsBlock = (actions: Action[]): Block => {
  return {
    type: "actions",
    elements: actions.map((a) => {
      const button: Record<string, unknown> = {
        type: "button",
        text: plainText(a.label, 75),
      };
      const style = buttonStyleToSlack(a.style);
      if (style) button.style = style;
      if (a.url) {
        // URL buttons navigate; action_id is required by Slack but the click
        // does not deliver a block_actions payload to the bot.
        button.url = a.url;
        button.action_id = placeholderActionId(a.actionId);
      } else {
        button.action_id = placeholderActionId(a.actionId);
        if (a.value !== undefined) button.value = a.value;
      }
      return button;
    }),
  } as Block;
};

const renderTextCard = (card: Extract<Card, {kind: "text"}>): KnownBlock[] => {
  const blocks: KnownBlock[] = [{type: "section", text: mrkdwn(card.markdown)} as SectionBlock];
  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

const renderYesNoCard = (card: Extract<Card, {kind: "yes_no"}>): KnownBlock[] => {
  return [
    {type: "section", text: mrkdwn(`*${card.question}*`)} as SectionBlock,
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: plainText(card.yesLabel, 75),
          style: "primary",
          action_id: placeholderActionId(`${card.actionId}:yes`),
          value: "yes",
        },
        {
          type: "button",
          text: plainText(card.noLabel, 75),
          action_id: placeholderActionId(`${card.actionId}:no`),
          value: "no",
        },
      ],
    } as unknown as KnownBlock,
  ];
};

const fmt = (n: number, unit: string): string => `${Math.round(n)}${unit}`;

const renderWeatherCard = (card: Extract<Card, {kind: "weather"}>): KnownBlock[] => {
  const headline = `*${card.location}* — ${card.summary}\n${fmt(card.tempF, "°F")}${
    card.feelsLikeF !== undefined ? ` (feels ${fmt(card.feelsLikeF, "°F")})` : ""
  }`;

  const fields: MrkdwnElement[] = [];
  if (card.highF !== undefined) fields.push(mrkdwn(`*High*\n${fmt(card.highF, "°F")}`, 75));
  if (card.lowF !== undefined) fields.push(mrkdwn(`*Low*\n${fmt(card.lowF, "°F")}`, 75));
  if (card.precipChance !== undefined)
    fields.push(mrkdwn(`*Precip*\n${Math.round(card.precipChance * 100)}%`, 75));
  if (card.windMph !== undefined) fields.push(mrkdwn(`*Wind*\n${fmt(card.windMph, " mph")}`, 75));

  const section: SectionBlock = {
    type: "section",
    text: mrkdwn(headline),
  };
  if (fields.length > 0) section.fields = fields;
  if (card.iconUrl) {
    section.accessory = {
      type: "image",
      image_url: card.iconUrl,
      alt_text: card.summary,
    };
  }
  const blocks: KnownBlock[] = [section];
  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

const renderCodeCard = (card: Extract<Card, {kind: "code"}>): KnownBlock[] => {
  const code = `\`\`\`${card.language ?? ""}\n${card.code}\n\`\`\``;
  const blocks: KnownBlock[] = [{type: "section", text: mrkdwn(code)} as SectionBlock];
  if (card.caption) {
    blocks.push({
      type: "context",
      elements: [mrkdwn(`_${card.caption}_`, 150)],
    } as ContextBlock);
  }
  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

/**
 * Phase 1 map rendering is a placeholder. Phase 4.2 swaps this for a Mapbox
 * Static image_url when AppConfig.maps.mapboxAccessToken is configured.
 */
const renderMapCard = (card: Extract<Card, {kind: "map"}>): KnownBlock[] => {
  const markers =
    card.markers.length > 0
      ? `\n${card.markers.length} marker${card.markers.length > 1 ? "s" : ""}`
      : "";
  const text = `*Map* — (${card.latitude.toFixed(4)}, ${card.longitude.toFixed(4)}), zoom ${card.zoom}${markers}`;
  const blocks: KnownBlock[] = [{type: "section", text: mrkdwn(text)} as SectionBlock];
  if (card.caption) {
    blocks.push({
      type: "context",
      elements: [mrkdwn(`_${card.caption}_`, 150)],
    } as ContextBlock);
  }
  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

const renderListCard = (card: Extract<Card, {kind: "list"}>): KnownBlock[] => {
  const blocks: KnownBlock[] = [];
  if (card.title) {
    blocks.push({type: "section", text: mrkdwn(`*${card.title}*`)} as SectionBlock);
  }
  for (const item of card.items) {
    const lines = [`*${item.title}*`];
    if (item.subtitle) lines.push(item.subtitle);
    if (item.badge) lines.push(`\`${item.badge.label}\``);
    const section: SectionBlock = {type: "section", text: mrkdwn(lines.join("\n"))};
    if (item.onPress) {
      const button: Record<string, unknown> = {
        type: "button",
        text: plainText(item.onPress.label, 75),
      };
      const style = buttonStyleToSlack(item.onPress.style);
      if (style) button.style = style;
      if (item.onPress.url) {
        button.url = item.onPress.url;
        button.action_id = placeholderActionId(item.onPress.actionId);
      } else {
        button.action_id = placeholderActionId(item.onPress.actionId);
        if (item.onPress.value !== undefined) button.value = item.onPress.value;
      }
      section.accessory = button as unknown as SectionBlock["accessory"];
    }
    blocks.push(section);
  }
  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

const renderErrorCard = (card: Extract<Card, {kind: "error"}>): KnownBlock[] => {
  const text = card.detail ? `${card.message}\n\n_${card.detail}_` : card.message;
  return [
    {
      type: "context",
      elements: [mrkdwn(`:warning: ${text}`, 3000)],
    } as ContextBlock,
  ];
};

const renderImageCard = (card: Extract<Card, {kind: "image"}>): KnownBlock[] => {
  const blocks: KnownBlock[] = [
    {
      type: "image",
      image_url: card.url,
      alt_text: card.altText,
      title: card.caption ? plainText(card.caption) : undefined,
    } as ImageBlock,
  ];
  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

const renderTableCard = (card: Extract<Card, {kind: "table"}>): KnownBlock[] => {
  const blocks: KnownBlock[] = [];
  if (card.title) {
    blocks.push({type: "section", text: mrkdwn(`*${card.title}*`)} as SectionBlock);
  }

  if (card.columns.length === 2) {
    // Two-column tables use a section's fields[] (Slack renders them as two columns).
    // Each section holds up to 10 fields (5 rows). Chunk if needed.
    const fields: MrkdwnElement[] = [];
    fields.push(mrkdwn(`*${card.columns[0]}*`, 200));
    fields.push(mrkdwn(`*${card.columns[1]}*`, 200));
    for (const row of card.rows) {
      fields.push(mrkdwn(row[0], 200));
      fields.push(mrkdwn(row[1], 200));
    }
    // Slack max fields per section is 10. Chunk into multiple sections.
    for (let i = 0; i < fields.length; i += 10) {
      blocks.push({type: "section", fields: fields.slice(i, i + 10)} as SectionBlock);
    }
  } else {
    // 3-4 column tables fall back to one row per section, "col1: val1 | col2: val2 …".
    const header = card.columns.map((c) => `*${c}*`).join(" | ");
    blocks.push({type: "section", text: mrkdwn(header)} as SectionBlock);
    blocks.push({type: "divider"} as DividerBlock);
    for (const row of card.rows) {
      const line = card.columns.map((c, i) => `*${c}*: ${row[i] ?? ""}`).join(" | ");
      blocks.push({type: "section", text: mrkdwn(line)} as SectionBlock);
    }
  }

  if (card.actions?.length) blocks.push(actionsBlock(card.actions) as KnownBlock);
  return blocks;
};

const renderCard = (card: Card): KnownBlock[] => {
  switch (card.kind) {
    case "text":
      return renderTextCard(card);
    case "yes_no":
      return renderYesNoCard(card);
    case "weather":
      return renderWeatherCard(card);
    case "code":
      return renderCodeCard(card);
    case "map":
      return renderMapCard(card);
    case "list":
      return renderListCard(card);
    case "error":
      return renderErrorCard(card);
    case "image":
      return renderImageCard(card);
    case "table":
      return renderTableCard(card);
  }
};

export class SlackBlockKitRenderer implements CardRenderer<SlackRenderResult> {
  readonly channelType: ChannelType = "slack";
  readonly supportsRich = true;

  render(response: RichResponse): SlackRenderResult {
    const blocks: KnownBlock[] = [];
    for (let i = 0; i < response.cards.length; i++) {
      const card = response.cards[i];
      const cardBlocks = renderCard(card);
      // Add a divider between cards (not before the first, not after the last)
      if (i > 0) blocks.push({type: "divider"} as DividerBlock);
      blocks.push(...cardBlocks);
    }

    // Hard ceiling: drop trailing blocks beyond the Slack limit. The truncate
    // step upstream should keep us within budget; this is defense-in-depth.
    if (blocks.length > SLACK_MAX_BLOCKS) {
      blocks.length = SLACK_MAX_BLOCKS;
    }

    return {blocks, text: response.fallbackText};
  }
}

export const slackRenderer = new SlackBlockKitRenderer();
