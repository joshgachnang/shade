import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  canWriteGlobalMemory,
  canWriteGroupMemory,
  ensureGroupDirectory,
  getGlobalMemoryPath,
  getGroupMemoryPath,
  readMemory,
  writeMemory,
} from "./memory";

const tmpDir = path.join(process.cwd(), `tmp-test-memory-${Date.now()}`);

// Override config.paths.groups for testing
import {config} from "../config";

const originalGroupsPath = config.paths.groups;

beforeEach(async () => {
  await fs.mkdir(tmpDir, {recursive: true});
  config.paths.groups = tmpDir;
});

afterEach(async () => {
  config.paths.groups = originalGroupsPath;
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe("getGlobalMemoryPath", () => {
  test("returns path to CLAUDE.md in groups directory", () => {
    const result = getGlobalMemoryPath();
    expect(result).toBe(path.join(tmpDir, "CLAUDE.md"));
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
