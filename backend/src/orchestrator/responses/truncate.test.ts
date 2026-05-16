import {describe, expect, test} from "bun:test";
import {type Card, MAX_CARDS, type RichResponse, SCHEMA_VERSION} from "./schema";
import {truncateRichResponse} from "./truncate";

const textCard = (i: number): Card => ({kind: "text", markdown: `card-${i}`});

const buildResponse = (count: number): RichResponse => ({
  v: SCHEMA_VERSION,
  fallbackText: "fallback",
  cards: Array.from({length: count}, (_, i) => textCard(i)),
});

describe("truncateRichResponse", () => {
  test("returns input unchanged when at or below limit", () => {
    const r = buildResponse(MAX_CARDS);
    const out = truncateRichResponse(r, {autoTruncate: true});
    expect(out).toEqual(r);
  });

  test("returns input unchanged when single card", () => {
    const r = buildResponse(1);
    const out = truncateRichResponse(r, {autoTruncate: true});
    expect(out.cards.length).toBe(1);
  });

  test("autoTruncate=true keeps MAX_CARDS-1 originals + notice card", () => {
    const r = buildResponse(25);
    const out = truncateRichResponse(r, {autoTruncate: true});
    expect(out.cards.length).toBe(MAX_CARDS);
    // First MAX_CARDS-1 cards are the originals
    for (let i = 0; i < MAX_CARDS - 1; i++) {
      expect(out.cards[i]).toEqual(textCard(i));
    }
    const last = out.cards[MAX_CARDS - 1];
    expect(last.kind).toBe("text");
    if (last.kind === "text") {
      expect(last.markdown).toContain("truncated");
    }
  });

  test("autoTruncate=true at exactly MAX_CARDS+1 still truncates", () => {
    const r = buildResponse(MAX_CARDS + 1);
    const out = truncateRichResponse(r, {autoTruncate: true});
    expect(out.cards.length).toBe(MAX_CARDS);
    const last = out.cards[MAX_CARDS - 1];
    expect(last.kind).toBe("text");
  });

  test("autoTruncate=false replaces with single ErrorCard", () => {
    const r = buildResponse(15);
    const out = truncateRichResponse(r, {autoTruncate: false});
    expect(out.cards.length).toBe(1);
    expect(out.cards[0].kind).toBe("error");
    if (out.cards[0].kind === "error") {
      expect(out.cards[0].message).toContain("too many");
      expect(out.cards[0].detail).toContain("15");
    }
  });

  test("preserves fallbackText and version", () => {
    const r: RichResponse = {
      v: SCHEMA_VERSION,
      fallbackText: "specific text",
      cards: Array.from({length: 12}, (_, i) => textCard(i)),
    };
    const out = truncateRichResponse(r, {autoTruncate: true});
    expect(out.v).toBe(SCHEMA_VERSION);
    expect(out.fallbackText).toBe("specific text");
  });
});
