import {describe, expect, test} from "bun:test";
import {SCHEMA_VERSION} from "../schema";
import {FallbackTextRenderer, pickRenderer, SlackBlockKitRenderer, TerrenoRenderer} from "./index";

describe("pickRenderer", () => {
  test("slack returns SlackBlockKitRenderer", () => {
    expect(pickRenderer("slack")).toBeInstanceOf(SlackBlockKitRenderer);
  });

  test("email/webhook/imessage return FallbackTextRenderer", () => {
    expect(pickRenderer("email")).toBeInstanceOf(FallbackTextRenderer);
    expect(pickRenderer("webhook")).toBeInstanceOf(FallbackTextRenderer);
    expect(pickRenderer("imessage")).toBeInstanceOf(FallbackTextRenderer);
  });

  test("terreno returns TerrenoRenderer (which throws on render)", () => {
    const r = pickRenderer("terreno");
    expect(r).toBeInstanceOf(TerrenoRenderer);
    expect(() =>
      r.render({
        v: SCHEMA_VERSION,
        fallbackText: "x",
        cards: [{kind: "text", markdown: "x"}],
      })
    ).toThrow(/not implemented/);
  });
});
