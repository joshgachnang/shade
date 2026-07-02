import {describe, expect, test} from "bun:test";
import {Card, MAX_CARDS, RichResponse, SCHEMA_VERSION} from "./schema";

const wrap = (card: unknown) => ({
  v: SCHEMA_VERSION,
  cards: [card],
  fallbackText: "fallback",
});

describe("RichResponse schema — accept valid cards", () => {
  test("text card", () => {
    expect(() => RichResponse.parse(wrap({kind: "text", markdown: "hello"}))).not.toThrow();
  });

  test("yes_no card", () => {
    expect(() =>
      RichResponse.parse(wrap({kind: "yes_no", question: "Proceed?", actionId: "confirm_delete"}))
    ).not.toThrow();
  });

  test("weather card", () => {
    expect(() =>
      RichResponse.parse(
        wrap({
          kind: "weather",
          location: "SF",
          summary: "Sunny",
          tempF: 68,
          precipChance: 0.1,
        })
      )
    ).not.toThrow();
  });

  test("code card", () => {
    expect(() =>
      RichResponse.parse(wrap({kind: "code", language: "ts", code: "const x = 1;"}))
    ).not.toThrow();
  });

  test("map card with markers", () => {
    expect(() =>
      RichResponse.parse(
        wrap({
          kind: "map",
          latitude: 37.7749,
          longitude: -122.4194,
          markers: [{lat: 37.7749, lng: -122.4194, label: "Here", color: "primary"}],
        })
      )
    ).not.toThrow();
  });

  test("list card", () => {
    expect(() =>
      RichResponse.parse(
        wrap({
          kind: "list",
          title: "Tasks",
          items: [
            {title: "Buy milk"},
            {title: "Pay bills", badge: {label: "due", color: "warning"}},
          ],
        })
      )
    ).not.toThrow();
  });

  test("error card", () => {
    expect(() =>
      RichResponse.parse(wrap({kind: "error", message: "Boom", detail: "Stack…"}))
    ).not.toThrow();
  });

  test("image card", () => {
    expect(() =>
      RichResponse.parse(wrap({kind: "image", url: "https://example.com/x.png", altText: "x"}))
    ).not.toThrow();
  });

  test("table card", () => {
    expect(() =>
      RichResponse.parse(
        wrap({
          kind: "table",
          columns: ["Name", "Age"],
          rows: [
            ["Alice", "30"],
            ["Bob", "25"],
          ],
        })
      )
    ).not.toThrow();
  });

  test("merged card accepts actions row (text + actions)", () => {
    expect(() =>
      RichResponse.parse(
        wrap({
          kind: "text",
          markdown: "Pick one",
          actions: [
            {actionId: "approve", label: "Approve", style: "primary"},
            {actionId: "deny", label: "Deny", style: "danger"},
          ],
        })
      )
    ).not.toThrow();
  });
});

describe("RichResponse schema — reject malformed payloads", () => {
  test("unknown discriminator kind", () => {
    expect(() => RichResponse.parse(wrap({kind: "unknown", foo: "bar"}))).toThrow();
  });

  test("wrong schema version", () => {
    expect(() =>
      RichResponse.parse({v: "2", cards: [{kind: "text", markdown: "x"}], fallbackText: "x"})
    ).toThrow();
  });

  test("empty cards array", () => {
    expect(() => RichResponse.parse({v: SCHEMA_VERSION, cards: [], fallbackText: "x"})).toThrow();
  });

  test("too many cards (max 10)", () => {
    const card = {kind: "text" as const, markdown: "x"};
    expect(() =>
      RichResponse.parse({
        v: SCHEMA_VERSION,
        cards: Array(MAX_CARDS + 1).fill(card),
        fallbackText: "x",
      })
    ).toThrow();
  });

  test("table with mismatched row lengths", () => {
    expect(() =>
      RichResponse.parse(
        wrap({
          kind: "table",
          columns: ["A", "B"],
          rows: [["1", "2"], ["3"]],
        })
      )
    ).toThrow();
  });

  test("empty fallbackText", () => {
    expect(() =>
      RichResponse.parse({
        v: SCHEMA_VERSION,
        cards: [{kind: "text", markdown: "x"}],
        fallbackText: "",
      })
    ).toThrow();
  });

  test("yes_no card missing actionId", () => {
    expect(() => RichResponse.parse(wrap({kind: "yes_no", question: "ok?"}))).toThrow();
  });

  test("map card with out-of-range latitude", () => {
    expect(() => RichResponse.parse(wrap({kind: "map", latitude: 100, longitude: 0}))).toThrow();
  });

  test("image card with non-url", () => {
    expect(() =>
      RichResponse.parse(wrap({kind: "image", url: "not-a-url", altText: "x"}))
    ).toThrow();
  });

  test("text card exceeding 3000 chars", () => {
    expect(() => RichResponse.parse(wrap({kind: "text", markdown: "x".repeat(3001)}))).toThrow();
  });
});

describe("Card type inference", () => {
  test("discriminated parse picks the right variant", () => {
    const parsed = Card.parse({kind: "yes_no", question: "ok?", actionId: "a"});
    expect(parsed.kind).toBe("yes_no");
    if (parsed.kind === "yes_no") {
      // yesLabel/noLabel defaults populate
      expect(parsed.yesLabel).toBe("Yes");
      expect(parsed.noLabel).toBe("No");
    }
  });
});
