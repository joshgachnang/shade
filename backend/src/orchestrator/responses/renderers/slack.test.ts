import {describe, expect, test} from "bun:test";
import type {z} from "zod";
import {type Card, RichResponse, SCHEMA_VERSION} from "../schema";
import {SlackBlockKitRenderer} from "./slack";
import {placeholderActionId} from "./types";

const renderer = new SlackBlockKitRenderer();

/**
 * Test helper: wraps a single-card input and runs it through RichResponse.parse
 * so test fixtures may omit fields that the schema defaults (e.g. Action.style).
 */
const wrap = (card: z.input<typeof Card>): RichResponse =>
  RichResponse.parse({
    v: SCHEMA_VERSION,
    fallbackText: "fallback",
    cards: [card],
  });

describe("SlackBlockKitRenderer — per-kind output", () => {
  test("text card → single section with mrkdwn", () => {
    const {blocks, text} = renderer.render(wrap({kind: "text", markdown: "hello *world*"}));
    expect(text).toBe("fallback");
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("section");
  });

  test("text card with actions adds an actions block", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "text",
        markdown: "decide",
        actions: [
          {actionId: "ok", label: "OK", style: "primary"},
          {actionId: "cancel", label: "Cancel", style: "default"},
        ],
      })
    );
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("actions");
    const actionEls = (blocks[1] as {elements: Array<{action_id: string; style?: string}>})
      .elements;
    expect(actionEls[0].action_id).toBe(placeholderActionId("ok"));
    expect(actionEls[0].style).toBe("primary");
    expect(actionEls[1].style).toBeUndefined(); // "default" maps to no style
  });

  test("yes_no card → section + 2-button actions", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "yes_no",
        question: "Proceed?",
        actionId: "confirm",
        yesLabel: "Go",
        noLabel: "Stop",
      })
    );
    expect(blocks.length).toBe(2);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("actions");
    const els = (
      blocks[1] as {
        elements: Array<{text: {text: string}; action_id: string; style?: string; value: string}>;
      }
    ).elements;
    expect(els).toHaveLength(2);
    expect(els[0].text.text).toBe("Go");
    expect(els[0].style).toBe("primary");
    expect(els[0].action_id).toBe(placeholderActionId("confirm:yes"));
    expect(els[0].value).toBe("yes");
    expect(els[1].action_id).toBe(placeholderActionId("confirm:no"));
    expect(els[1].value).toBe("no");
  });

  test("weather card → section with headline + fields + optional icon", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "weather",
        location: "SF",
        summary: "Sunny",
        tempF: 68,
        feelsLikeF: 65,
        highF: 72,
        lowF: 55,
        precipChance: 0.1,
        windMph: 8,
        iconUrl: "https://example.com/sun.png",
      })
    );
    expect(blocks.length).toBe(1);
    const section = blocks[0] as {
      text: {text: string};
      fields?: Array<{text: string}>;
      accessory?: {type: string; image_url: string; alt_text: string};
    };
    expect(section.text.text).toContain("SF");
    expect(section.text.text).toContain("68°F");
    expect(section.fields).toBeDefined();
    expect(section.fields?.length).toBe(4);
    expect(section.accessory?.type).toBe("image");
    expect(section.accessory?.image_url).toBe("https://example.com/sun.png");
  });

  test("code card → mrkdwn fenced block (+ caption)", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "code",
        language: "ts",
        code: 'console.log("hi");',
        caption: "Example",
      })
    );
    expect(blocks.length).toBe(2);
    const section = blocks[0] as {text: {text: string}};
    expect(section.text.text).toContain("```ts");
    expect(section.text.text).toContain('console.log("hi");');
    expect(blocks[1].type).toBe("context");
  });

  test("map card placeholder includes coordinates and zoom", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "map",
        latitude: 37.7749,
        longitude: -122.4194,
        zoom: 12,
        markers: [{lat: 37.78, lng: -122.41}],
      })
    );
    const section = blocks[0] as {text: {text: string}};
    expect(section.text.text).toContain("37.7749");
    expect(section.text.text).toContain("-122.4194");
    expect(section.text.text).toContain("zoom 12");
    expect(section.text.text).toContain("1 marker");
  });

  test("list card with title, items, and onPress accessory", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "list",
        title: "Todos",
        items: [
          {
            title: "Pay bills",
            subtitle: "Overdue",
            badge: {label: "urgent", color: "error"},
            onPress: {actionId: "pay_bills", label: "Pay"},
          },
          {title: "Buy milk"},
        ],
      })
    );
    // 1 title + 2 item sections
    expect(blocks.length).toBe(3);
    const item0 = blocks[1] as {
      text: {text: string};
      accessory?: {action_id: string};
    };
    expect(item0.text.text).toContain("Pay bills");
    expect(item0.text.text).toContain("urgent");
    expect(item0.accessory?.action_id).toBe(placeholderActionId("pay_bills"));
  });

  test("error card → context block with warning icon", () => {
    const {blocks} = renderer.render(wrap({kind: "error", message: "Boom", detail: "stack"}));
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("context");
    const ctx = blocks[0] as {elements: Array<{text: string}>};
    expect(ctx.elements[0].text).toContain(":warning:");
    expect(ctx.elements[0].text).toContain("Boom");
    expect(ctx.elements[0].text).toContain("stack");
  });

  test("image card → image block", () => {
    const {blocks} = renderer.render(
      wrap({kind: "image", url: "https://example.com/x.png", altText: "x", caption: "cap"})
    );
    expect(blocks.length).toBe(1);
    expect(blocks[0].type).toBe("image");
    const img = blocks[0] as {image_url: string; alt_text: string; title?: {text: string}};
    expect(img.image_url).toBe("https://example.com/x.png");
    expect(img.alt_text).toBe("x");
    expect(img.title?.text).toBe("cap");
  });

  test("2-column table uses section.fields", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "table",
        columns: ["Name", "Age"],
        rows: [
          ["Alice", "30"],
          ["Bob", "25"],
        ],
      })
    );
    expect(blocks.length).toBe(1);
    const section = blocks[0] as {fields: Array<{text: string}>};
    // header (2) + 2 rows × 2 cells = 6 fields
    expect(section.fields.length).toBe(6);
    expect(section.fields[0].text).toBe("*Name*");
    expect(section.fields[2].text).toBe("Alice");
  });

  test("3-column table falls back to row-per-section", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "table",
        columns: ["A", "B", "C"],
        rows: [["1", "2", "3"]],
      })
    );
    // header section + divider + 1 row section
    expect(blocks.length).toBe(3);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("divider");
    expect(blocks[2].type).toBe("section");
  });
});

describe("SlackBlockKitRenderer — multi-card + budget", () => {
  test("multi-card response inserts dividers between cards", () => {
    const {blocks} = renderer.render({
      v: SCHEMA_VERSION,
      fallbackText: "f",
      cards: [
        {kind: "text", markdown: "one"},
        {kind: "text", markdown: "two"},
      ],
    });
    expect(blocks.length).toBe(3);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("divider");
    expect(blocks[2].type).toBe("section");
  });

  test("10 cards stays under Slack 50-block ceiling", () => {
    const cards: Card[] = Array.from({length: 10}, (_, i) => ({
      kind: "yes_no" as const,
      question: `Q${i}`,
      actionId: `a${i}`,
      yesLabel: "Yes",
      noLabel: "No",
    }));
    const {blocks} = renderer.render({
      v: SCHEMA_VERSION,
      fallbackText: "f",
      cards,
    });
    // 10 cards × 2 blocks/card + 9 dividers = 29
    expect(blocks.length).toBeLessThanOrEqual(50);
  });

  test("fallbackText is returned as the text field", () => {
    const {text} = renderer.render({
      v: SCHEMA_VERSION,
      fallbackText: "preview-this",
      cards: [{kind: "text", markdown: "x"}],
    });
    expect(text).toBe("preview-this");
  });
});

describe("SlackBlockKitRenderer — action_id namespace", () => {
  test("URL-typed action emits url-button (still has placeholder action_id)", () => {
    const {blocks} = renderer.render(
      wrap({
        kind: "text",
        markdown: "see",
        actions: [{actionId: "open_docs", label: "Docs", url: "https://example.com"}],
      })
    );
    const action = (blocks[1] as {elements: Array<{url?: string; action_id: string}>}).elements[0];
    expect(action.url).toBe("https://example.com");
    expect(action.action_id).toBe(placeholderActionId("open_docs"));
  });

  test("placeholder action_id is well-formed", () => {
    const id = placeholderActionId("confirm");
    expect(id.startsWith("shade:")).toBe(true);
    expect(id.endsWith(":confirm")).toBe(true);
    expect(id.length).toBeLessThan(255);
  });
});
