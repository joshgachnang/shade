import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {getSkillPath, isValidSkillName, listSkills, loadSkill, saveSkill} from "./skills";

const tmpDir = path.join(process.cwd(), `tmp-test-skills-${Date.now()}`);

// Override paths.skills for testing
import {paths} from "../config";

const originalSkillsPath = paths.skills;
const MAX_CHARS = 8000;

beforeEach(async () => {
  await fs.mkdir(tmpDir, {recursive: true});
  paths.skills = tmpDir;
});

afterEach(async () => {
  paths.skills = originalSkillsPath;
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe("isValidSkillName", () => {
  test("accepts kebab-case names", () => {
    expect(isValidSkillName("check-plex-health")).toBe(true);
    expect(isValidSkillName("skill")).toBe(true);
    expect(isValidSkillName("v2-migration-steps")).toBe(true);
  });

  test("rejects invalid names", () => {
    expect(isValidSkillName("../evil")).toBe(false);
    expect(isValidSkillName("..")).toBe(false);
    expect(isValidSkillName("foo/bar")).toBe(false);
    expect(isValidSkillName("Uppercase-Name")).toBe(false);
    expect(isValidSkillName("has spaces")).toBe(false);
    expect(isValidSkillName("trailing-")).toBe(false);
    expect(isValidSkillName("-leading")).toBe(false);
    expect(isValidSkillName("double--hyphen")).toBe(false);
    expect(isValidSkillName("")).toBe(false);
  });
});

describe("getSkillPath", () => {
  test("returns path to <name>.md in skills directory", () => {
    expect(getSkillPath("check-plex-health")).toBe(path.join(tmpDir, "check-plex-health.md"));
  });
});

describe("saveSkill", () => {
  test("writes a skill file with frontmatter", async () => {
    const result = await saveSkill({
      name: "check-plex-health",
      description: "Check the Plex server health",
      content: "1. curl the status endpoint\n2. restart if down",
      maxChars: MAX_CHARS,
    });
    expect(result.saved).toBe(true);
    expect(result.error).toBeUndefined();

    const raw = await fs.readFile(path.join(tmpDir, "check-plex-health.md"), "utf-8");
    expect(raw).toBe(
      "---\nname: check-plex-health\ndescription: Check the Plex server health\n---\n1. curl the status endpoint\n2. restart if down"
    );
  });

  test("creates the skills directory when missing", async () => {
    await fs.rm(tmpDir, {recursive: true, force: true});
    const result = await saveSkill({
      name: "fresh-dir",
      description: "First skill",
      content: "body",
      maxChars: MAX_CHARS,
    });
    expect(result.saved).toBe(true);

    const raw = await fs.readFile(path.join(tmpDir, "fresh-dir.md"), "utf-8");
    expect(raw).toContain("name: fresh-dir");
  });

  test("overwrites an existing skill of the same name", async () => {
    await saveSkill({name: "my-skill", description: "v1", content: "old", maxChars: MAX_CHARS});
    await saveSkill({name: "my-skill", description: "v2", content: "new", maxChars: MAX_CHARS});

    const loaded = await loadSkill({name: "my-skill"});
    expect(loaded.found).toBe(true);
    expect(loaded.content).toBe("new");
    expect(loaded.description).toBe("v2");

    const skills = await listSkills();
    expect(skills).toHaveLength(1);
  });

  test("rejects invalid names including path traversal", async () => {
    for (const name of ["../evil", "Uppercase", "has spaces", "foo/bar", ""]) {
      const result = await saveSkill({
        name,
        description: "desc",
        content: "body",
        maxChars: MAX_CHARS,
      });
      expect(result.saved).toBe(false);
      expect(result.error).toContain("Invalid skill name");
    }

    // Nothing escaped the skills dir and nothing was written.
    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
    const escaped = await fs.readdir(path.dirname(tmpDir));
    expect(escaped).not.toContain("evil.md");
  });

  test("rejects skills over the char cap", async () => {
    const result = await saveSkill({
      name: "too-big",
      description: "desc",
      content: "x".repeat(200),
      maxChars: 100,
    });
    expect(result.saved).toBe(false);
    expect(result.error).toContain("100 character limit");

    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });

  test("collapses newlines in the description", async () => {
    await saveSkill({
      name: "multi-line",
      description: "line one\nline two",
      content: "body",
      maxChars: MAX_CHARS,
    });

    const skills = await listSkills();
    expect(skills[0]?.description).toBe("line one line two");
  });
});

describe("listSkills", () => {
  test("returns name and description per skill, sorted by name", async () => {
    await saveSkill({name: "zeta", description: "Last", content: "z", maxChars: MAX_CHARS});
    await saveSkill({name: "alpha", description: "First", content: "a", maxChars: MAX_CHARS});

    const skills = await listSkills();
    expect(skills).toEqual([
      {name: "alpha", description: "First"},
      {name: "zeta", description: "Last"},
    ]);
  });

  test("returns empty list for empty directory", async () => {
    expect(await listSkills()).toEqual([]);
  });

  test("returns empty list for missing directory", async () => {
    await fs.rm(tmpDir, {recursive: true, force: true});
    expect(await listSkills()).toEqual([]);
  });

  test("ignores non-markdown and invalidly named files", async () => {
    await fs.writeFile(path.join(tmpDir, "notes.txt"), "not a skill", "utf-8");
    await fs.writeFile(path.join(tmpDir, "Bad Name.md"), "---\n---\nbody", "utf-8");
    await saveSkill({
      name: "real-skill",
      description: "Real",
      content: "body",
      maxChars: MAX_CHARS,
    });

    const skills = await listSkills();
    expect(skills).toEqual([{name: "real-skill", description: "Real"}]);
  });

  test("tolerates malformed frontmatter with an empty description", async () => {
    await fs.writeFile(path.join(tmpDir, "no-frontmatter.md"), "just a body", "utf-8");
    await fs.writeFile(path.join(tmpDir, "unclosed.md"), "---\nname: unclosed\nbody", "utf-8");

    const skills = await listSkills();
    expect(skills).toEqual([
      {name: "no-frontmatter", description: ""},
      {name: "unclosed", description: ""},
    ]);
  });
});

describe("loadSkill", () => {
  test("round-trips a saved skill", async () => {
    await saveSkill({
      name: "round-trip",
      description: "A round trip",
      content: "step 1\nstep 2\n\nstep 3",
      maxChars: MAX_CHARS,
    });

    const result = await loadSkill({name: "round-trip"});
    expect(result.found).toBe(true);
    expect(result.content).toBe("step 1\nstep 2\n\nstep 3");
    expect(result.description).toBe("A round trip");
    expect(result.validNames).toBeUndefined();
  });

  test("returns not-found with valid names for a missing skill", async () => {
    await saveSkill({name: "existing", description: "Here", content: "body", maxChars: MAX_CHARS});

    const result = await loadSkill({name: "missing-skill"});
    expect(result.found).toBe(false);
    expect(result.content).toBeUndefined();
    expect(result.validNames).toEqual(["existing"]);
  });

  test("returns not-found for invalid names without touching the filesystem", async () => {
    const result = await loadSkill({name: "../../etc/passwd"});
    expect(result.found).toBe(false);
    expect(result.validNames).toEqual([]);
  });

  test("returns the whole file as body when frontmatter is malformed", async () => {
    await fs.writeFile(path.join(tmpDir, "raw-skill.md"), "no frontmatter here", "utf-8");

    const result = await loadSkill({name: "raw-skill"});
    expect(result.found).toBe(true);
    expect(result.content).toBe("no frontmatter here");
    expect(result.description).toBe("");
  });

  test("preserves --- lines inside the body", async () => {
    await saveSkill({
      name: "with-divider",
      description: "Has a divider",
      content: "before\n---\nafter",
      maxChars: MAX_CHARS,
    });

    const result = await loadSkill({name: "with-divider"});
    expect(result.content).toBe("before\n---\nafter");
  });
});
