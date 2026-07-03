import fs from "node:fs/promises";
import path from "node:path";
import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import mongoose from "mongoose";
import {paths} from "../config";
import {AgentTask} from "../models/agentTask";
import {LlmFixture} from "../models/llmFixture";
import {Message} from "../models/message";
import {ScheduledTask} from "../models/scheduledTask";
import {getOrchestrator} from "../orchestrator";
import {seedTestMode} from "../testMode/seed";
import type {UserDocument} from "../types";
import {requireUser} from "../utils/auth";

/** Collections /test/reset never touches — identity and config survive resets. */
const PRESERVED_COLLECTIONS = new Set(["users", "appconfigs"]);

const requireAdmin = (req: Request): UserDocument => {
  const user = requireUser(req);
  if (!user.admin) {
    throw new APIError({status: 403, title: "Admin access required"});
  }
  return user;
};

/**
 * Defense-in-depth for the destructive routes: even though this plugin only
 * mounts with SHADE_TEST_MODE=1 outside production, refuse to wipe anything
 * unless the connected database is unmistakably a test database. ("test" is
 * mongodb-memory-server's default db name in bun tests.)
 */
const assertTestDatabase = (): void => {
  const dbName = mongoose.connection.db?.databaseName ?? "";
  if (dbName !== "test" && !dbName.endsWith("-test")) {
    throw new APIError({
      status: 403,
      title: `Refusing destructive test operation: database "${dbName}" is not a test database`,
    });
  }
};

const clearDirectory = async (dir: string): Promise<void> => {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries.map((entry) => fs.rm(path.join(dir, entry), {recursive: true, force: true}))
  );
};

/**
 * Test control API for the AI testability harness (IP-012):
 *
 *   POST /test/reset        — wipe to freshly-seeded state (users/config survive)
 *   GET  /test/outbox       — outbound bot messages (?groupId=&since=)
 *   POST /test/tick         — force a loop pass ({target: scheduler|messageLoop|ipc|taskWorker|all})
 *   POST /test/llm-fixtures — program the mock's next responses
 *   GET  /test/llm-fixtures — list active fixtures
 *   DELETE /test/llm-fixtures/:id
 *   GET  /test/state        — pending/active counts for loop-closing assertions
 *
 * Mounted by server.ts only when SHADE_TEST_MODE=1 and NODE_ENV !== "production".
 */
export class TestHarnessPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    app.post(
      "/test/reset",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);
        assertTestDatabase();

        const collections = mongoose.connection.collections;
        await Promise.all(
          Object.entries(collections)
            .filter(([name]) => !PRESERVED_COLLECTIONS.has(name))
            .map(([, collection]) => collection.deleteMany({}))
        );

        await Promise.all([clearDirectory(paths.ipc), clearDirectory(paths.sessions)]);

        const seeded = await seedTestMode();

        // The orchestrator's ChannelManager caches groups/connectors — rebuild
        // it so the re-seeded group is live immediately.
        const orchestrator = getOrchestrator();
        if (orchestrator) {
          await orchestrator.channelManager.disconnectAll();
          await orchestrator.channelManager.initialize();
        }

        logger.info("Test harness: database reset and re-seeded");
        res.json({data: seeded});
      })
    );

    app.get(
      "/test/outbox",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);

        const {groupId, since} = req.query as {groupId?: string; since?: string};
        const query: Record<string, unknown> = {isFromBot: true};
        if (groupId) {
          query.groupId = groupId;
        }
        if (since) {
          const sinceDate = new Date(since);
          if (Number.isNaN(sinceDate.getTime())) {
            throw new APIError({status: 400, title: "since must be an ISO date string"});
          }
          query.created = {$gt: sinceDate};
        }

        const messages = await Message.find(query).sort({created: 1}).limit(200);
        res.json({
          data: messages.map((message) => ({
            id: message._id.toString(),
            groupId: message.groupId.toString(),
            content: message.content,
            richPayload: message.richPayload,
            correlationId: message.correlationId,
            created: message.created,
          })),
        });
      })
    );

    app.post(
      "/test/tick",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);

        const {target} = req.body as {target?: string};
        const validTargets = ["scheduler", "messageLoop", "ipc", "taskWorker", "all"];
        if (!target || !validTargets.includes(target)) {
          throw new APIError({
            status: 400,
            title: `target must be one of: ${validTargets.join(", ")}`,
          });
        }

        const orchestrator = getOrchestrator();
        if (!orchestrator) {
          throw new APIError({status: 503, title: "Orchestrator not running"});
        }

        const ticked: string[] = [];
        // "all" runs in pipeline order: inbound messages → board claims →
        // due scheduled tasks → IPC delivery of whatever the runs produced.
        if (target === "messageLoop" || target === "all") {
          await orchestrator.messageLoop.tickNow();
          ticked.push("messageLoop");
        }
        if (target === "taskWorker" || target === "all") {
          await orchestrator.taskWorker.tick();
          ticked.push("taskWorker");
        }
        if (target === "scheduler" || target === "all") {
          orchestrator.scheduler.wake();
          ticked.push("scheduler");
        }
        if (target === "ipc" || target === "all") {
          await orchestrator.ipcWatcher.tickNow();
          ticked.push("ipc");
        }

        res.json({data: {ticked}});
      })
    );

    app.post(
      "/test/llm-fixtures",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);
        const fixture = await LlmFixture.create(req.body);
        res.status(201).json({data: fixture.toJSON()});
      })
    );

    app.get(
      "/test/llm-fixtures",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);
        const fixtures = await LlmFixture.find({deleted: {$ne: true}}).sort({
          priority: -1,
          created: 1,
        });
        res.json({data: fixtures.map((fixture) => fixture.toJSON())});
      })
    );

    app.delete(
      "/test/llm-fixtures/:id",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);
        await LlmFixture.findByIdAndUpdate(req.params.id, {$set: {deleted: true}});
        res.status(204).send();
      })
    );

    app.get(
      "/test/state",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        requireAdmin(req);

        const orchestrator = getOrchestrator();
        const now = new Date();
        const [pendingMessages, pendingAgentTasks, runningAgentTasks, dueScheduledTasks] =
          await Promise.all([
            Message.countDocuments({processedAt: {$exists: false}, isFromBot: false}),
            AgentTask.countDocuments({status: "pending"}),
            AgentTask.countDocuments({status: {$in: ["claimed", "running"]}}),
            ScheduledTask.countDocuments({status: "active", nextRunAt: {$lte: now}}),
          ]);

        res.json({
          data: {
            pendingMessages,
            activeAgentRuns: orchestrator?.groupQueue.getActiveAgentCount() ?? 0,
            activeBoardRuns: orchestrator?.taskWorker.activeCount ?? 0,
            pendingAgentTasks,
            runningAgentTasks,
            dueScheduledTasks,
          },
        });
      })
    );
  }
}
