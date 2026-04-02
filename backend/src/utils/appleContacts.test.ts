import {describe, expect, test} from "bun:test";
import {formatShadeContext, mergeShadeContext, parseShadeContext} from "./appleContacts";

describe("parseShadeContext", () => {
  test("returns empty context when no shade block exists", () => {
    const {userNote, context} = parseShadeContext("Just a regular note about this person.");
    expect(userNote).toBe("Just a regular note about this person.");
    expect(context).toEqual({});
  });

  test("returns empty context for empty string", () => {
    const {userNote, context} = parseShadeContext("");
    expect(userNote).toBe("");
    expect(context).toEqual({});
  });

  test("parses all fields from a full shade context block", () => {
    const note = `Met at a conference.

--- Shade Context ---
Relationship: coworker
Met: 2025-03-15 at tech conference
Interests: hiking, photography, ML
Topics: working on search feature, learning Rust
Preferences: prefers morning meetings, likes concise emails
Recent: got promoted to staff engineer (2025-06)
Recent: moving to Seattle (2025-09)
favorite_color: blue
--- End Shade Context ---`;

    const {userNote, context} = parseShadeContext(note);
    expect(userNote).toBe("Met at a conference.");
    expect(context.relationship).toBe("coworker");
    expect(context.metAt).toBe("2025-03-15 at tech conference");
    expect(context.interests).toEqual(["hiking", "photography", "ML"]);
    expect(context.topics).toEqual(["working on search feature", "learning Rust"]);
    expect(context.preferences).toEqual(["prefers morning meetings", "likes concise emails"]);
    expect(context.recentUpdates).toEqual([
      "got promoted to staff engineer (2025-06)",
      "moving to Seattle (2025-09)",
    ]);
    expect(context.customFields).toEqual({favorite_color: "blue"});
  });

  test("handles missing end marker", () => {
    const note = `Some note.

--- Shade Context ---
Relationship: friend
Interests: cooking`;

    const {userNote, context} = parseShadeContext(note);
    expect(userNote).toBe("Some note.");
    expect(context.relationship).toBe("friend");
    expect(context.interests).toEqual(["cooking"]);
  });
});

describe("formatShadeContext", () => {
  test("formats a full context block", () => {
    const result = formatShadeContext({
      relationship: "coworker",
      metAt: "2025-03 at conference",
      interests: ["hiking", "ML"],
      topics: ["search project"],
      preferences: ["morning meetings"],
      recentUpdates: ["promoted (2025-06)"],
      customFields: {team: "platform"},
    });

    expect(result).toContain("--- Shade Context ---");
    expect(result).toContain("--- End Shade Context ---");
    expect(result).toContain("Relationship: coworker");
    expect(result).toContain("Met: 2025-03 at conference");
    expect(result).toContain("Interests: hiking, ML");
    expect(result).toContain("Topics: search project");
    expect(result).toContain("Preferences: morning meetings");
    expect(result).toContain("Recent: promoted (2025-06)");
    expect(result).toContain("team: platform");
  });

  test("omits empty fields", () => {
    const result = formatShadeContext({relationship: "friend"});
    expect(result).toContain("Relationship: friend");
    expect(result).not.toContain("Interests:");
    expect(result).not.toContain("Topics:");
  });
});

describe("mergeShadeContext", () => {
  test("creates new context block when none exists", () => {
    const result = mergeShadeContext("Old user note.", {
      relationship: "friend",
      interests: ["hiking"],
    });

    expect(result).toContain("Old user note.");
    expect(result).toContain("--- Shade Context ---");
    expect(result).toContain("Relationship: friend");
    expect(result).toContain("Interests: hiking");
  });

  test("merges interests additively", () => {
    const existingNote = `Note.

--- Shade Context ---
Interests: hiking, cooking
--- End Shade Context ---`;

    const result = mergeShadeContext(existingNote, {
      interests: ["cooking", "photography"],
    });

    // Should have all three unique interests
    expect(result).toContain("hiking");
    expect(result).toContain("cooking");
    expect(result).toContain("photography");
  });

  test("appends recent updates", () => {
    const existingNote = `--- Shade Context ---
Recent: started new job (2025-01)
--- End Shade Context ---`;

    const result = mergeShadeContext(existingNote, {
      recentUpdates: ["got a dog (2025-06)"],
    });

    expect(result).toContain("Recent: started new job (2025-01)");
    expect(result).toContain("Recent: got a dog (2025-06)");
  });

  test("caps recent updates at 10", () => {
    const existingUpdates = Array.from({length: 9}, (_, i) => `Recent: update ${i + 1}`);
    const existingNote = `--- Shade Context ---\n${existingUpdates.join("\n")}\n--- End Shade Context ---`;

    const result = mergeShadeContext(existingNote, {
      recentUpdates: ["update 10", "update 11"],
    });

    // Should have 10 updates (dropped the first one)
    const matches = result.match(/Recent:/g);
    expect(matches?.length).toBe(10);
    expect(result).not.toContain("update 1\n");
    expect(result).toContain("update 11");
  });

  test("overwrites scalar fields", () => {
    const existingNote = `--- Shade Context ---
Relationship: acquaintance
--- End Shade Context ---`;

    const result = mergeShadeContext(existingNote, {
      relationship: "close friend",
    });

    expect(result).toContain("Relationship: close friend");
    expect(result).not.toContain("acquaintance");
  });
});
