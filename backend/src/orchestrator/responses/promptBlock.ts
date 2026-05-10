import {richResponseJsonSchemaString} from "./jsonSchema";

/**
 * System-prompt fragment that teaches the LLM how to use `respond_with_card`.
 * Returns "" when the feature is disabled so it can be unconditionally
 * concatenated.
 */
export const richResponseSystemPromptBlock = (opts: {enabled: boolean}): string => {
  if (!opts.enabled) {
    return "";
  }

  return [
    "## Structured Card Responses",
    "",
    "You may answer with a structured `respond_with_card` payload instead of plain text",
    "when structure materially helps the reader: yes/no decisions, code samples, weather,",
    "maps, lists, tables, images, errors, or multi-section answers. Default to plain text",
    "for conversational prose.",
    "",
    "**Hard rules:**",
    "- If your response is just prose, do NOT call `respond_with_card`.",
    "- Never call both `send_message` and `respond_with_card` in the same response — choose one.",
    "- Always populate `fallbackText` with a useful plain-text version (used on Email/iMessage/webhook channels).",
    "- Keep `cards` ≤ 10. Anything beyond will be auto-truncated.",
    "",
    "The full JSON Schema for the `respond_with_card` argument is:",
    "",
    "```json",
    richResponseJsonSchemaString,
    "```",
    "",
    "**Examples:**",
    "",
    "Yes/no confirmation:",
    "```json",
    JSON.stringify(
      {
        v: "1",
        cards: [
          {
            kind: "yes_no",
            question: "Delete branch `feature/x`?",
            actionId: "delete_branch_x",
          },
        ],
        fallbackText: "Delete branch feature/x? Reply 'yes' or 'no'.",
      },
      null,
      2
    ),
    "```",
    "",
    "Weather:",
    "```json",
    JSON.stringify(
      {
        v: "1",
        cards: [
          {
            kind: "weather",
            location: "San Francisco",
            summary: "Partly cloudy",
            tempF: 64,
            highF: 71,
            lowF: 55,
            precipChance: 0.1,
          },
        ],
        fallbackText: "San Francisco: partly cloudy, 64°F (high 71, low 55), 10% precip.",
      },
      null,
      2
    ),
    "```",
    "",
    "Code sample:",
    "```json",
    JSON.stringify(
      {
        v: "1",
        cards: [
          {
            kind: "code",
            language: "ts",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: literal example for the LLM
            code: "const greet = (name: string) => `hello, ${name}`;",
            caption: "Greet helper",
          },
        ],
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal example for the LLM
        fallbackText: "const greet = (name: string) => `hello, ${name}`;",
      },
      null,
      2
    ),
    "```",
  ].join("\n");
};
