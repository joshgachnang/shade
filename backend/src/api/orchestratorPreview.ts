import {APIError, asyncHandler, authenticateMiddleware, type TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {Message} from "../models/message";
import {pickRenderer} from "../orchestrator/responses/renderers";
import type {SlackBlockKitRenderer} from "../orchestrator/responses/renderers/slack";
import type {SlackRenderResult} from "../orchestrator/responses/renderers/types";
import {RichResponse} from "../orchestrator/responses/schema";
import {truncateRichResponse} from "../orchestrator/responses/truncate";
import type {UserDocument} from "../types";

const requireAdmin = (req: express.Request): void => {
  const user = req.user as UserDocument | undefined;
  if (!user) {
    throw new APIError({status: 401, title: "Authentication required"});
  }
  if (!user.admin) {
    throw new APIError({status: 403, title: "Admin access required"});
  }
};

/**
 * Admin-only inspection routes for the rich-response renderer.
 *
 * POST /orchestrator/preview-card     — validate + render a RichResponse JSON
 * GET  /orchestrator/messages/:id/rich — fetch a Message with richPayload + rendered blocks
 */
export class OrchestratorPreviewPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.post(
      "/orchestrator/preview-card",
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        requireAdmin(req);
        const parsed = RichResponse.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            slackBlocks: null,
            fallbackText: null,
            validation: parsed.error.issues,
          });
          return;
        }
        const truncated = truncateRichResponse(parsed.data, {autoTruncate: true});
        const renderer = pickRenderer("slack") as SlackBlockKitRenderer;
        const rendered = renderer.render(truncated);
        res.json({
          slackBlocks: rendered.blocks,
          fallbackText: rendered.text,
          validation: null,
        });
      })
    );

    app.get(
      "/orchestrator/messages/:id/rich",
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        requireAdmin(req);
        const message = await Message.findById(req.params.id);
        if (!message) {
          res.status(404).json({error: "Message not found"});
          return;
        }
        const richPayload = message.richPayload as unknown;
        let slackBlocks: SlackRenderResult["blocks"] | null = null;
        if (richPayload) {
          const parsed = RichResponse.safeParse(richPayload);
          if (parsed.success) {
            const renderer = pickRenderer("slack") as SlackBlockKitRenderer;
            slackBlocks = renderer.render(parsed.data).blocks;
          }
        }
        res.json({
          message: message.toJSON(),
          richPayload: richPayload ?? null,
          slackBlocks,
        });
      })
    );
  }
}
