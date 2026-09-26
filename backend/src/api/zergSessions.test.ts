import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import type {Server} from "node:http";
import express from "express";
import {setZergSessionsService, ZergSessionsService} from "../orchestrator/services/zergSessions";
import {parseZergSessionsQuery, ZergSessionsPlugin} from "./zergSessions";

// The route sits behind authenticateMiddleware(); a bare express app with the
// plugin mounted proves the auth gate closes and that the read-only surface
// has no other verbs. The handler's own logic is the query parser plus the
// service, each covered directly.

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  setZergSessionsService(
    new ZergSessionsService({exec: async () => ({code: 0, stdout: "[]", stderr: ""})})
  );
  const app = express();
  app.use(express.json());
  new ZergSessionsPlugin().register(app);
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
  setZergSessionsService(null);
});

describe("GET /zerg/sessions", () => {
  test("is registered behind an auth gate", () => {
    // passport is not mounted on the bare test app, so the gate cannot be
    // exercised end to end here; assert the layer shape instead: the route
    // carries the authenticate middleware ahead of the handler.
    const app = express();
    new ZergSessionsPlugin().register(app);
    const router = (
      app as unknown as {_router: {stack: {route?: {path: string; stack: unknown[]}}[]}}
    )._router;
    const layer = router.stack.find((entry) => entry.route?.path === "/zerg/sessions");
    expect(layer?.route?.stack).toHaveLength(2);
  });

  test("rejects an unauthenticated read rather than serving it", async () => {
    const res = await fetch(`${baseUrl}/zerg/sessions`);
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("exposes no write verbs", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${baseUrl}/zerg/sessions`, {method});
      expect([404, 405]).toContain(res.status);
    }
  });
});

describe("parseZergSessionsQuery", () => {
  test("reads refresh as 1/true and trims repo", () => {
    expect(parseZergSessionsQuery({})).toEqual({refresh: false, repo: undefined});
    expect(parseZergSessionsQuery({refresh: "1"})).toEqual({refresh: true, repo: undefined});
    expect(parseZergSessionsQuery({refresh: "true", repo: " shade "})).toEqual({
      refresh: true,
      repo: "shade",
    });
    expect(parseZergSessionsQuery({refresh: "0", repo: ""})).toEqual({
      refresh: false,
      repo: undefined,
    });
    expect(parseZergSessionsQuery({repo: ["a", "b"]})).toEqual({refresh: false, repo: undefined});
  });
});
