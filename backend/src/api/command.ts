import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {requireUser} from "../utils/auth";

/**
 * POST /command
 *
 * Authenticated endpoint that injects a message into the system exactly the way
 * a Slack message would arrive — by creating a Message document for a group.
 * This lets E2E tests drive the orchestrator without needing a real Slack connection.
 *
 * Body:
 *   - content:  string  (required) — the message text (e.g. "@Shade do something")
 *   - groupId:  string  (optional) — target group _id. Uses the first group if omitted.
 *   - groupName: string (optional) — target group by name. Ignored if groupId is set.
 */
export class CommandPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    app.post(
      "/command",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = requireUser(req);

        const {content, groupId, groupName} = req.body as {
          content?: string;
          groupId?: string;
          groupName?: string;
        };

        if (!content || typeof content !== "string" || content.trim().length === 0) {
          throw new APIError({
            status: 400,
            title: "content is required and must be a non-empty string",
          });
        }

        // Resolve the target group
        let group;
        if (groupId) {
          group = await Group.findById(groupId);
        } else if (groupName) {
          group = await Group.findOne({name: groupName});
        } else {
          group = await Group.findOne({});
        }

        if (!group) {
          throw new APIError({status: 404, title: "No group found"});
        }

        // Create the message exactly like ChannelManager.handleInboundMessage does
        const message = await Message.create({
          groupId: group._id,
          channelId: group.channelId,
          sender: user.name,
          senderExternalId: user._id.toString(),
          content: content.trim(),
          isFromBot: false,
          metadata: {source: "command-api", userId: user._id.toString()},
        });

        logger.info(
          `Command API: message created by ${user.name} in group "${group.name}": "${content.substring(0, 80)}"`
        );

        res.status(201).json({
          data: {
            messageId: message._id.toString(),
            groupId: group._id.toString(),
            groupName: group.name,
          },
        });
      })
    );
  }
}
