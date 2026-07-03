import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import {AppConfig, reloadAppConfig} from "../models/appConfig";
import {getOrchestrator} from "../orchestrator";
import {requireUser} from "../utils/auth";

/**
 * Trivia Monitor API endpoints (formerly Trivia Auto-Search).
 *
 * POST /trivia/toggle  — Enable/disable the trivia monitor
 * POST /trivia/ask     — Submit a manual trivia question (routes through
 *                        TriviaMonitor.handleChatMessage so the user must be
 *                        in `triviaMonitor.allowedUserIds`).
 * GET  /trivia/status  — Get the current monitor config.
 */
export class TriviaMonitorPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    app.post(
      "/trivia/toggle",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = requireUser(req);

        const {enabled} = req.body as {enabled?: boolean};
        if (typeof enabled !== "boolean") {
          throw new APIError({status: 400, title: "enabled must be a boolean"});
        }

        await AppConfig.findOneAndUpdate({}, {$set: {"triviaMonitor.enabled": enabled}});
        await reloadAppConfig();

        const orchestrator = getOrchestrator();
        if (orchestrator) {
          if (enabled) {
            await orchestrator.triviaMonitor.start();
          } else {
            orchestrator.triviaMonitor.stop();
          }
        }

        logger.info(`Trivia monitor ${enabled ? "enabled" : "disabled"} by ${user.email}`);
        res.json({enabled});
      })
    );

    app.post(
      "/trivia/ask",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = requireUser(req);

        const {question} = req.body as {question?: string};
        if (!question || typeof question !== "string" || question.trim().length === 0) {
          throw new APIError({
            status: 400,
            title: "question is required and must be a non-empty string",
          });
        }

        const orchestrator = getOrchestrator();
        if (!orchestrator) {
          throw new APIError({status: 503, title: "Orchestrator not running"});
        }

        const handled = await orchestrator.triviaMonitor.handleChatMessage(
          `!trivia ${question}`,
          user._id.toString(),
          ""
        );

        if (!handled) {
          throw new APIError({
            status: 403,
            title:
              "User not allowed to submit trivia questions. Add your user ID to triviaMonitor.allowedUserIds.",
          });
        }

        res.json({status: "processing", question});
      })
    );

    app.get(
      "/trivia/status",
      authenticateMiddleware(),
      asyncHandler(async (_req: Request, res: Response) => {
        const config = await AppConfig.findOneOrNone({});
        res.json({
          enabled: config?.triviaMonitor?.enabled ?? false,
          groupId: config?.triviaMonitor?.groupId ?? "",
          allowedUserIds: config?.triviaMonitor?.allowedUserIds ?? [],
          questionsWebhook: config?.triviaMonitor?.questionsWebhook ?? "",
          answersWebhook: config?.triviaMonitor?.answersWebhook ?? "",
        });
      })
    );
  }
}
