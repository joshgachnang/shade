import {afterEach, beforeEach, describe, expect, spyOn, test} from "bun:test";
import type {Server} from "node:http";
import express from "express";
import {EdgeAgent} from "../models/edgeAgent";
import {EdgeAgentEvent} from "../models/edgeAgentEvent";
import {EdgePlugin} from "./edgePlugin";

// Mounts the plugin on a bare express app with the same error semantics as the
// real server (APIError -> status). Regression coverage for the agent auth
// header: agents send X-Agent-Token, NOT Authorization: Bearer — Bearer values
// that aren't JWTs get 401ed by the global decodeJWTMiddleware in production.

let server: Server;
let baseUrl: string;
let mockFindOne: ReturnType<typeof spyOn>;
let mockEventCreate: ReturnType<typeof spyOn>;

const agentDoc = {
  _id: "agent-1",
  name: "test-agent",
  status: "approved",
  config: {pollIntervalMs: 5000},
  secrets: undefined,
};

beforeEach(async () => {
  mockFindOne = spyOn(EdgeAgent, "findOne").mockImplementation((() =>
    Promise.resolve(agentDoc)) as never);
  mockEventCreate = spyOn(EdgeAgentEvent, "create").mockImplementation((() =>
    Promise.resolve({})) as never);

  const app = express();
  app.use(express.json());
  new EdgePlugin().register(app);
  app.use(
    (
      err: {status?: number; title?: string},
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.status ?? 500).json({title: err.title});
    }
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  baseUrl = `http://localhost:${address.port}`;
});

afterEach(() => {
  server.close();
  mockFindOne.mockRestore();
  mockEventCreate.mockRestore();
});

describe("edge agent auth", () => {
  test("accepts a valid X-Agent-Token", async () => {
    const res = await fetch(`${baseUrl}/api/edge/config`, {
      headers: {"X-Agent-Token": "token-123"},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {config: unknown};
    expect(body.config).toEqual(agentDoc.config);
  });

  test("rejects a missing token", async () => {
    const res = await fetch(`${baseUrl}/api/edge/config`);
    expect(res.status).toBe(401);
  });

  test("rejects Authorization: Bearer — agents must use X-Agent-Token", async () => {
    const res = await fetch(`${baseUrl}/api/edge/config`, {
      headers: {Authorization: "Bearer token-123"},
    });
    expect(res.status).toBe(401);
  });

  test("rejects an unknown token", async () => {
    mockFindOne.mockImplementation((() => Promise.resolve(null)) as never);
    const res = await fetch(`${baseUrl}/api/edge/config`, {
      headers: {"X-Agent-Token": "bogus"},
    });
    expect(res.status).toBe(401);
  });
});
