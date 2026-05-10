import {logger} from "@terreno/api";
import {MAX_CARDS, type RichResponse, SCHEMA_VERSION} from "./schema";

export interface TruncateOpts {
  autoTruncate: boolean;
}

/**
 * Truncate a RichResponse to MAX_CARDS.
 *
 * - autoTruncate=true: keep the first MAX_CARDS cards and append a text card
 *   noting that the response was truncated.
 * - autoTruncate=false: replace cards with a single ErrorCard.
 *
 * A response already within the limit is returned unchanged.
 */
export const truncateRichResponse = (input: RichResponse, opts: TruncateOpts): RichResponse => {
  if (input.cards.length <= MAX_CARDS) {
    return input;
  }

  const overflow = input.cards.length - MAX_CARDS;
  logger.warn(
    `RichResponse truncated: ${input.cards.length} cards exceeds MAX_CARDS=${MAX_CARDS} ` +
      `(autoTruncate=${opts.autoTruncate})`
  );

  if (!opts.autoTruncate) {
    return {
      v: SCHEMA_VERSION,
      fallbackText: input.fallbackText,
      cards: [
        {
          kind: "error",
          message: "Response rejected: too many cards.",
          detail: `Received ${input.cards.length} cards; limit is ${MAX_CARDS}.`,
        },
      ],
    };
  }

  // Keep the first MAX_CARDS - 1 cards and append a notice. That preserves a
  // slot for the warning while staying inside the cap.
  const kept = input.cards.slice(0, MAX_CARDS - 1);
  return {
    v: SCHEMA_VERSION,
    fallbackText: input.fallbackText,
    cards: [
      ...kept,
      {
        kind: "text",
        markdown:
          `_Note: ${overflow + 1} additional card(s) were truncated to keep the response ` +
          `within Slack's block limit._`,
      },
    ],
  };
};
