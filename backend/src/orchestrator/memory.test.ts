import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {loadAppConfig} from "../models/appConfig";
import {
  applyMemoryUpdate,
  buildSystemPrompt,
  canWriteGlobalMemory,
  canWriteGroupMemory,
  ensureGroupDirectory,
  getGlobalMemoryPath,
  getGroupMemoryPath,
  getUserProfilePath,
  readMemory,
  writeMemory,
} from "./memory";

const tmpDir = path.join(process.cwd(), `tmp-test-memory-${Date.now()}`);

// Override paths.groups for testing
import {paths} from "../config";

const originalGroupsPath = paths.groups;

beforeEach(async () => {
  await fs.mkdir(tmpDir, {recursive: true});
  paths.groups = tmpDir;
});

afterEach(async () => {
  paths.groups = originalGroupsPath;
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe("getGlobalMemoryPath", () => {
  test("returns path to CLAUDE.md in groups directory", () => {
    const result = getGlobalMemoryPath();
    expect(result).toBe(path.join(tmpDir, "CLAUDE.md"));
  });
});

describe("getUserProfilePath", () => {
  test("returns path to USER.md in groups directory", () => {
    const result = getUserProfilePath();
    expect(result).toBe(path.join(tmpDir, "USER.md"));
  });
});

describe("getGroupMemoryPath", () => {
  test("returns path to CLAUDE.md in group folder", () => {
    const result = getGroupMemoryPath("my-group");
    expect(result).toBe(path.join(tmpDir, "my-group", "CLAUDE.md"));
  });
});

describe("readMemory", () => {
  test("reads existing file content", async () => {
    const filePath = path.join(tmpDir, "test.md");
    await fs.writeFile(filePath, "# Test Memory\nSome content", "utf-8");
    const result = await readMemory(filePath);
    expect(result).toBe("# Test Memory\nSome content");
  });

  test("returns null for non-existent file", async () => {
    const result = await readMemory(path.join(tmpDir, "nonexistent.md"));
    expect(result).toBeNull();
  });
});

describe("writeMemory", () => {
  test("writes content to file", async () => {
    const filePath = path.join(tmpDir, "write-test.md");
    await writeMemory(filePath, "# Written Content");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("# Written Content");
  });

  test("creates parent directories if needed", async () => {
    const filePath = path.join(tmpDir, "nested", "deep", "file.md");
    await writeMemory(filePath, "content");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("content");
  });

  test("overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "overwrite.md");
    await writeMemory(filePath, "original");
    await writeMemory(filePath, "updated");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("updated");
  });
});

describe("ensureGroupDirectory", () => {
  test("creates group directory and returns path", async () => {
    const result = await ensureGroupDirectory("new-group");
    expect(result).toBe(path.join(tmpDir, "new-group"));

    const stat = await fs.stat(result);
    expect(stat.isDirectory()).toBe(true);
  });

  test("is idempotent for existing directory", async () => {
    await ensureGroupDirectory("existing-group");
    const result = await ensureGroupDirectory("existing-group");
    expect(result).toBe(path.join(tmpDir, "existing-group"));
  });
});

describe("applyMemoryUpdate", () => {
  test("replace overwrites existing content", async () => {
    const filePath = path.join(tmpDir, "apply-replace.md");
    await writeMemory(filePath, "original");

    const result = await applyMemoryUpdate({
      filePath,
      content: "updated",
      mode: "replace",
      maxChars: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.size).toBe("updated".length);
    expect(await fs.readFile(filePath, "utf-8")).toBe("updated");
  });

  test("append joins existing content with a newline", async () => {
    const filePath = path.join(tmpDir, "apply-append.md");
    await writeMemory(filePath, "first");

    const result = await applyMemoryUpdate({
      filePath,
      content: "second",
      mode: "append",
      maxChars: 100,
    });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(filePath, "utf-8")).toBe("first\nsecond");
  });

  test("append to a missing file writes the content as-is", async () => {
    const filePath = path.join(tmpDir, "apply-append-new.md");

    const result = await applyMemoryUpdate({
      filePath,
      content: "fresh",
      mode: "append",
      maxChars: 100,
    });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(filePath, "utf-8")).toBe("fresh");
  });

  test("rejects when the resulting size exceeds maxChars and writes nothing", async () => {
    const filePath = path.join(tmpDir, "apply-cap.md");
    await writeMemory(filePath, "existing content");

    const result = await applyMemoryUpdate({
      filePath,
      content: "way too much additional content",
      mode: "append",
      maxChars: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Condense");
    expect(await fs.readFile(filePath, "utf-8")).toBe("existing content");
  });
});

describe("buildSystemPrompt", () => {
  const skillsTmpDir = path.join(process.cwd(), `tmp-test-memory-skills-${Date.now()}`);
  const originalSkillsPath = paths.skills;

  const setMemoryEnabled = async (enabled: boolean): Promise<void> => {
    const config = await loadAppConfig();
    config.set("memory.enabled", enabled);
    await config.save();
  };

  const seedMemoryFiles = async (): Promise<void> => {
    await fs.writeFile(path.join(tmpDir, "SOUL.md"), "SOUL-CONTENT", "utf-8");
    await fs.writeFile(path.join(tmpDir, "USER.md"), "USER-CONTENT", "utf-8");
    await fs.writeFile(path.join(tmpDir, "CLAUDE.md"), "GLOBAL-CONTENT", "utf-8");
    await fs.mkdir(path.join(tmpDir, "test-group"), {recursive: true});
    await fs.writeFile(path.join(tmpDir, "test-group", "CLAUDE.md"), "GROUP-CONTENT", "utf-8");
  };

  const seedSkills = async (): Promise<void> => {
    await fs.writeFile(
      path.join(skillsTmpDir, "check-plex-health.md"),
      "---\nname: check-plex-health\ndescription: Check the Plex server health\n---\nPLEX-SKILL-BODY",
      "utf-8"
    );
    await fs.writeFile(
      path.join(skillsTmpDir, "rotate-logs.md"),
      "---\nname: rotate-logs\ndescription: Rotate the server logs\n---\nROTATE-SKILL-BODY",
      "utf-8"
    );
  };

  beforeEach(async () => {
    await fs.mkdir(skillsTmpDir, {recursive: true});
    paths.skills = skillsTmpDir;
  });

  afterEach(async () => {
    paths.skills = originalSkillsPath;
    await fs.rm(skillsTmpDir, {recursive: true, force: true});
    await setMemoryEnabled(true);
  });

  test("orders sections SOUL, USER, global, group", async () => {
    await seedMemoryFiles();

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    const soulIdx = prompt.indexOf("SOUL-CONTENT");
    const userIdx = prompt.indexOf("USER-CONTENT");
    const globalIdx = prompt.indexOf("GLOBAL-CONTENT");
    const groupIdx = prompt.indexOf("GROUP-CONTENT");
    expect(soulIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(soulIdx);
    expect(globalIdx).toBeGreaterThan(userIdx);
    expect(groupIdx).toBeGreaterThan(globalIdx);
    expect(prompt).not.toContain("FALLBACK");
  });

  test("omits USER.md when memory.enabled is false", async () => {
    await seedMemoryFiles();
    await setMemoryEnabled(false);

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    expect(prompt).not.toContain("USER-CONTENT");
    expect(prompt).toContain("SOUL-CONTENT");
    expect(prompt).toContain("GLOBAL-CONTENT");
    expect(prompt).toContain("GROUP-CONTENT");
  });

  test("includes the memory prompt block when memory.enabled is true", async () => {
    await seedMemoryFiles();

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    expect(prompt).toContain("## Memory & Learning");
    expect(prompt).toContain("search_history");
    expect(prompt).toContain("save_skill");
  });

  test("omits the memory prompt block when memory.enabled is false", async () => {
    await seedMemoryFiles();
    await setMemoryEnabled(false);

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    expect(prompt).not.toContain("## Memory & Learning");
  });

  test("includes a skills index with names and descriptions but not bodies", async () => {
    await seedMemoryFiles();
    await seedSkills();

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("- check-plex-health — Check the Plex server health");
    expect(prompt).toContain("- rotate-logs — Rotate the server logs");
    expect(prompt).toContain("load_skill");
    expect(prompt).not.toContain("PLEX-SKILL-BODY");
    expect(prompt).not.toContain("ROTATE-SKILL-BODY");
  });

  test("orders trailing blocks: rich responses, memory block, skills index", async () => {
    await seedMemoryFiles();
    await seedSkills();
    // Other test files may leave richResponses disabled in the shared config.
    const config = await loadAppConfig();
    config.set("richResponses.enabled", true);
    await config.save();

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    const richIdx = prompt.indexOf("## Structured Card Responses");
    const memoryIdx = prompt.indexOf("## Memory & Learning");
    const skillsIdx = prompt.indexOf("## Skills");
    expect(richIdx).toBeGreaterThanOrEqual(0);
    expect(memoryIdx).toBeGreaterThan(richIdx);
    expect(skillsIdx).toBeGreaterThan(memoryIdx);
  });

  test("omits the skills index when there are no skills", async () => {
    await seedMemoryFiles();

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    expect(prompt).not.toContain("## Skills");
  });

  test("omits the skills index when memory.enabled is false", async () => {
    await seedMemoryFiles();
    await seedSkills();
    await setMemoryEnabled(false);

    const prompt = await buildSystemPrompt("test-group", "FALLBACK");

    expect(prompt).not.toContain("## Skills");
    expect(prompt).not.toContain("check-plex-health");
  });
});

describe("canWriteGlobalMemory", () => {
  test("returns true for main group", () => {
    expect(canWriteGlobalMemory(true)).toBe(true);
  });

  test("returns false for non-main group", () => {
    expect(canWriteGlobalMemory(false)).toBe(false);
  });
});

describe("canWriteGroupMemory", () => {
  test("returns true when requesting group matches target", () => {
    expect(canWriteGroupMemory("my-group", "my-group")).toBe(true);
  });

  test("returns false when requesting group differs from target", () => {
    expect(canWriteGroupMemory("other-group", "my-group")).toBe(false);
  });
});
