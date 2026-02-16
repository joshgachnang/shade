import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import {appendToTranscript, readTranscript} from "./sessions";

const tmpDir = path.join(process.cwd(), `tmp-test-sessions-${Date.now()}`);

beforeEach(async () => {
  await fs.mkdir(tmpDir, {recursive: true});
});

afterEach(async () => {
  await fs.rm(tmpDir, {recursive: true, force: true});
});

describe("appendToTranscript", () => {
  test("creates file and appends a JSONL entry", async () => {
    const filePath = path.join(tmpDir, "transcript.jsonl");
    await appendToTranscript(filePath, {type: "user_message", content: "hello"});

    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("user_message");
    expect(parsed.content).toBe("hello");
    expect(parsed.timestamp).toBeDefined();
  });

  test("appends multiple entries as separate lines", async () => {
    const filePath = path.join(tmpDir, "multi.jsonl");
    await appendToTranscript(filePath, {type: "user_message", content: "first"});
    await appendToTranscript(filePath, {type: "agent_response", output: "second"});

    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(2);

    expect(JSON.parse(lines[0]).content).toBe("first");
    expect(JSON.parse(lines[1]).output).toBe("second");
  });

  test("adds timestamp to each entry", async () => {
    const filePath = path.join(tmpDir, "timestamp.jsonl");
    const before = new Date().toISOString();
    await appendToTranscript(filePath, {type: "test"});
    const after = new Date().toISOString();

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed.timestamp >= before).toBe(true);
    expect(parsed.timestamp <= after).toBe(true);
  });
});

describe("readTranscript", () => {
  test("reads JSONL entries from file", async () => {
    const filePath = path.join(tmpDir, "read.jsonl");
    await fs.writeFile(
      filePath,
      '{"type":"a","timestamp":"2024-01-01T00:00:00Z"}\n{"type":"b","timestamp":"2024-01-01T00:01:00Z"}\n',
      "utf-8"
    );

    const entries = await readTranscript(filePath);
    expect(entries.length).toBe(2);
    expect(entries[0].type).toBe("a");
    expect(entries[1].type).toBe("b");
  });

  test("returns empty array for non-existent file", async () => {
    const entries = await readTranscript(path.join(tmpDir, "nonexistent.jsonl"));
    expect(entries).toEqual([]);
  });

  test("handles empty file", async () => {
    const filePath = path.join(tmpDir, "empty.jsonl");
    await fs.writeFile(filePath, "", "utf-8");
    const entries = await readTranscript(filePath);
    expect(entries).toEqual([]);
  });

  test("roundtrips with appendToTranscript", async () => {
    const filePath = path.join(tmpDir, "roundtrip.jsonl");
    await appendToTranscript(filePath, {type: "user_message", sender: "alice", content: "hi"});
    await appendToTranscript(filePath, {type: "agent_response", output: "hello"});

    const entries = await readTranscript(filePath);
    expect(entries.length).toBe(2);
    expect(entries[0].type).toBe("user_message");
    expect(entries[0].sender).toBe("alice");
    expect(entries[1].type).toBe("agent_response");
    expect(entries[1].output).toBe("hello");
  });
});
