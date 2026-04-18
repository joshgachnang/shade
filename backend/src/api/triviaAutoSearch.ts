import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import {AppConfig, reloadAppConfig} from "../models/appConfig";
import {getOrchestrator} from "../orchestrator";
import type {UserDocument} from "../types";

/**
 * Trivia Auto-Search API endpoints.
 *
 * POST /trivia/toggle       — Enable/disable trivia auto-search
 * POST /trivia/ask           — Submit a manual trivia question
 * GET  /trivia/status        — Get current auto-search status
 */
export class TriviaAutoSearchPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    // POST /trivia/toggle — enable or disable auto-search
    app.post(
      "/trivia/toggle",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as UserDocument | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const {enabled} = req.body as {enabled?: boolean};
        if (typeof enabled !== "boolean") {
          throw new APIError({status: 400, title: "enabled must be a boolean"});
        }

        await AppConfig.findOneAndUpdate({}, {$set: {"triviaAutoSearch.enabled": enabled}});
        await reloadAppConfig();

        const orchestrator = getOrchestrator();
        if (orchestrator) {
          if (enabled) {
            await orchestrator.triviaAutoSearch.start();
          } else {
            orchestrator.triviaAutoSearch.stop();
          }
        }

        logger.info(`Trivia auto-search ${enabled ? "enabled" : "disabled"} by ${user.email}`);
        res.json({enabled});
      })
    );

    // POST /trivia/ask — submit a manual question
    app.post(
      "/trivia/ask",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as UserDocument | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

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

        // Use the user's ID as the sender for the manual question handler
        const handled = await orchestrator.triviaAutoSearch.handleChatMessage(
          `!trivia ${question}`,
          user._id.toString(),
          ""
        );

        if (!handled) {
          throw new APIError({
            status: 403,
            title:
              "User not allowed to submit trivia questions. Add your user ID to triviaAutoSearch.allowedUserIds.",
          });
        }

        res.json({status: "processing", question});
      })
    );

    // GET /trivia/status — get current config
    app.get(
      "/trivia/status",
      authenticateMiddleware(),
      asyncHandler(async (_req: Request, res: Response) => {
        const config = await AppConfig.findOneOrNone({});
        res.json({
          enabled: config?.triviaAutoSearch?.enabled ?? false,
          groupId: config?.triviaAutoSearch?.groupId ?? "",
          allowedUserIds: config?.triviaAutoSearch?.allowedUserIds ?? [],
        });
      })
    );
  }
}
