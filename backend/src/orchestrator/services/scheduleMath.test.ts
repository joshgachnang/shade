import {describe, expect, test} from "bun:test";
import {computeNextRun, parseIntervalMs} from "./scheduleMath";

describe("parseIntervalMs", () => {
  test("parses bare integer as seconds", () => {
    expect(parseIntervalMs("300")).toBe(300_000);
  });

  test("parses shorthand units", () => {
    expect(parseIntervalMs("30s")).toBe(30_000);
    expect(parseIntervalMs("5m")).toBe(300_000);
    expect(parseIntervalMs("2h")).toBe(7_200_000);
    expect(parseIntervalMs("1d")).toBe(86_400_000);
    expect(parseIntervalMs("5 m")).toBe(300_000);
  });

  test("parses ISO-8601 duration", () => {
    expect(parseIntervalMs("PT5M")).toBe(300_000);
    expect(parseIntervalMs("PT1H30M")).toBe(5_400_000);
  });

  test("rejects invalid or non-positive values", () => {
    expect(parseIntervalMs("")).toBeNull();
    expect(parseIntervalMs("0")).toBeNull();
    expect(parseIntervalMs("abc")).toBeNull();
    expect(parseIntervalMs("5x")).toBeNull();
  });
});

describe("computeNextRun", () => {
  const from = new Date("2026-05-31T12:01:00.000Z");

  test("interval adds the parsed duration to from", () => {
    const next = computeNextRun({scheduleType: "interval", schedule: "5m", from});
    expect(next?.toISOString()).toBe("2026-05-31T12:06:00.000Z");
  });

  test("cron returns the next matching instant after from", () => {
    const next = computeNextRun({scheduleType: "cron", schedule: "*/5 * * * *", from});
    expect(next?.toISOString()).toBe("2026-05-31T12:05:00.000Z");
  });

  test("once returns the fixed scheduled instant (even if in the past)", () => {
    const past = computeNextRun({
      scheduleType: "once",
      schedule: "2020-01-01T00:00:00Z",
      from,
    });
    expect(past?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  test("returns null for invalid schedules", () => {
    expect(computeNextRun({scheduleType: "interval", schedule: "nope", from})).toBeNull();
    expect(computeNextRun({scheduleType: "cron", schedule: "not a cron", from})).toBeNull();
    expect(computeNextRun({scheduleType: "once", schedule: "not a date", from})).toBeNull();
  });
});
