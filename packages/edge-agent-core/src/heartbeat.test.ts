import {afterEach, describe, expect, test} from "bun:test";
import {heartbeatTick, resetHeartbeatBackoff} from "./heartbeat";

// Regression: a failed heartbeat set backoffMs, and the tick skipped whenever
// backoffMs > 0 — but only a successful send cleared it, so one failure
// (e.g. the gateway restarting) silenced the agent forever. The backoff is a
// deadline now; ticks after it must retry.

const options = {
  state: {agentId: "a", token: "t", shadeUrl: "http://stub.invalid", registeredAt: ""},
  intervalMs: 30_000,
  version: "0.0.0",
  onCommand: async () => ({commandId: "x", success: true, completedAt: ""}),
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetHeartbeatBackoff();
});

describe("heartbeatTick", () => {
  test("skips during backoff, then recovers after the deadline", async () => {
    resetHeartbeatBackoff();

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("connection refused");
    }) as never;

    // First tick fails and arms a 1s backoff
    expect(await heartbeatTick(options)).toBe(true);
    expect(calls).toBe(1);

    // Within the backoff window: skipped, no fetch
    expect(await heartbeatTick(options, Date.now())).toBe(false);
    expect(calls).toBe(1);

    // Past the deadline: retries — this is the case the old flag never hit
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({status: "online", commands: []}))) as never;
    expect(await heartbeatTick(options, Date.now() + 2_000)).toBe(true);

    // Success cleared the backoff: next tick sends immediately
    expect(await heartbeatTick(options, Date.now())).toBe(true);
  });
});
