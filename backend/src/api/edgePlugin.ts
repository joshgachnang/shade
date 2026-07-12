import crypto from "node:crypto";
import {
  commandSchema,
  dataPushSchema,
  heartbeatRequestSchema,
  registrationRequestSchema,
} from "@shade/edge-agent-types";
import {
  APIError,
  asyncHandler,
  authenticateMiddleware,
  logger,
  type TerrenoPlugin,
} from "@terreno/api";
import type express from "express";
import {applyCalendarSync, applyRemindersSync} from "../edge/appleSync";
import {decryptSecrets, generateToken, hashToken} from "../edge/crypto";
import {Channel} from "../models/channel";
import {EdgeAgent} from "../models/edgeAgent";
import {EdgeAgentEvent} from "../models/edgeAgentEvent";
import {Group} from "../models/group";
import {Message} from "../models/message";
import {getOrchestrator} from "../orchestrator";
import type {EdgeAgentDocument} from "../types";

// Agents authenticate with the X-Agent-Token header (matching X-Bootstrap-Secret
// on register), NOT Authorization: Bearer — the global decodeJWTMiddleware 401s
// any Bearer value that isn't a valid JWT before routes ever see the request.
const validateAgentToken = async (req: express.Request): Promise<EdgeAgentDocument> => {
  const token = req.headers["x-agent-token"];
  if (!token || typeof token !== "string") {
    throw new APIError({status: 401, title: "Missing X-Agent-Token header"});
  }

  const tokenHash = hashToken(token);

  const agent = await EdgeAgent.findOne({authTokenHash: tokenHash});
  if (!agent) {
    throw new APIError({status: 401, title: "Invalid agent token"});
  }

  return agent;
};

export class EdgePlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    // ─── Agent-facing endpoints ───

    // POST /api/edge/register — self-register with bootstrap secret
    app.post(
      "/api/edge/register",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const bootstrapSecret = process.env.SHADE_BOOTSTRAP_SECRET;
        if (!bootstrapSecret) {
          throw new APIError({status: 500, title: "Bootstrap secret not configured"});
        }

        const providedSecret = req.headers["x-bootstrap-secret"] as string;
        if (!providedSecret || providedSecret !== bootstrapSecret) {
          throw new APIError({status: 401, title: "Invalid bootstrap secret"});
        }

        const body = registrationRequestSchema.parse(req.body);

        // Check for duplicate name
        const existing = await EdgeAgent.findOne({name: body.name});
        if (existing) {
          throw new APIError({status: 409, title: `Agent with name "${body.name}" already exists`});
        }

        const token = generateToken();
        const authTokenHash = hashToken(token);

        const agent = await EdgeAgent.create({
          name: body.name,
          agentType: body.agentType,
          status: "pending",
          platform: body.platform,
          arch: body.arch,
          version: body.version,
          hostname: body.hostname,
          capabilities: body.capabilities,
          authTokenHash,
        });

        await EdgeAgentEvent.create({
          agentId: agent._id,
          eventType: "registered",
          payload: {
            name: body.name,
            agentType: body.agentType,
            platform: body.platform,
            hostname: body.hostname,
          },
        });

        logger.info(`Edge agent registered: "${body.name}" (${body.agentType}) — pending approval`);

        res.status(201).json({agentId: agent._id.toString(), token});
      })
    );

    // POST /api/edge/heartbeat — agent heartbeat
    app.post(
      "/api/edge/heartbeat",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const agent = await validateAgentToken(req);
        const body = heartbeatRequestSchema.parse(req.body);

        // Process command results from the agent
        if (body.commandResults.length > 0) {
          for (const result of body.commandResults) {
            await EdgeAgentEvent.create({
              agentId: agent._id,
              eventType: result.success ? "command_completed" : "command_failed",
              payload: result,
            });
          }
        }

        // Atomically deliver and clear pending commands. A live heartbeat
        // recovers offline/error agents (the health monitor sets those on
        // stale heartbeats); only pending/rejected stay as-is.
        const newStatus =
          agent.status === "approved" ||
          agent.status === "online" ||
          agent.status === "offline" ||
          agent.status === "error"
            ? "online"
            : agent.status;

        const updated = await EdgeAgent.findOneAndUpdate(
          {_id: agent._id},
          {
            $set: {
              lastHeartbeatAt: new Date(),
              status: newStatus,
              pendingCommands: [],
              ...(body.platform && {platform: body.platform}),
              ...(body.arch && {arch: body.arch}),
              ...(body.version && {version: body.version}),
              ...(body.hostname && {hostname: body.hostname}),
              ...(body.commandResults.length > 0 && {lastCommandResults: body.commandResults}),
            },
          },
          {new: false} // Return the OLD document (with pending commands)
        );

        // Log status change if it happened
        if (updated && updated.status !== newStatus) {
          await EdgeAgentEvent.create({
            agentId: agent._id,
            eventType: "status_changed",
            payload: {from: updated.status, to: newStatus},
          });
        }

        const commands = (updated?.pendingCommands ?? []).map((cmd) => ({
          commandId: cmd.commandId,
          type: cmd.type,
          payload: cmd.payload,
        }));

        res.json({
          status: newStatus,
          commands,
        });
      })
    );

    // GET /api/edge/config — pull config + secrets
    app.get(
      "/api/edge/config",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const agent = await validateAgentToken(req);

        if (agent.status === "pending") {
          throw new APIError({status: 403, title: "Agent not yet approved"});
        }

        let secrets: Record<string, unknown> = {};
        if (agent.secrets && typeof agent.secrets === "string") {
          try {
            secrets = decryptSecrets(agent.secrets as unknown as string);
          } catch (err) {
            logger.error(`Failed to decrypt secrets for agent "${agent.name}": ${err}`);
          }
        } else if (agent.secrets && typeof agent.secrets === "object") {
          secrets = agent.secrets;
        }

        await EdgeAgentEvent.create({
          agentId: agent._id,
          eventType: "config_pulled",
          payload: {},
        });

        res.json({
          config: agent.config,
          secrets,
        });
      })
    );

    // POST /api/edge/data — push data (messages, events, channel requests)
    app.post(
      "/api/edge/data",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const agent = await validateAgentToken(req);

        if (agent.status === "pending") {
          throw new APIError({status: 403, title: "Agent not yet approved"});
        }

        const body = dataPushSchema.parse(req.body);

        if (body.type === "messages") {
          let channelId = agent.channelId;

          // If no channel linked yet, try to find or create one
          if (!channelId) {
            const channel = await Channel.findOne({type: agent.agentType});
            if (channel) {
              channelId = channel._id;
              await EdgeAgent.findByIdAndUpdate(agent._id, {$set: {channelId: channel._id}});
            }
          }

          if (!channelId) {
            throw new APIError({
              status: 400,
              title: "No channel linked. Send a channel_request first.",
            });
          }

          for (const msg of body.payload.messages) {
            // Find group by external ID
            const group = await Group.findOne({
              channelId,
              externalId: msg.groupExternalId,
            });

            if (!group) {
              // Auto-create group for this chat
              const newGroup = await Group.create({
                name: msg.groupExternalId,
                folder: `edge/${agent.agentType}/${msg.groupExternalId}`,
                channelId,
                externalId: msg.groupExternalId,
                trigger: "",
                requiresTrigger: false,
                isMain: false,
              });

              // Register with the live orchestrator — the message loop only
              // sees groups in the channel manager's cache, so without this
              // the new chat would be dead until the next restart.
              getOrchestrator()?.channelManager.registerGroup(newGroup);

              await Message.create({
                groupId: newGroup._id,
                channelId,
                externalId: msg.externalId,
                sender: msg.sender,
                senderExternalId: msg.senderExternalId,
                content: msg.content,
                isFromBot: false,
                metadata: msg.metadata ?? {},
              });
            } else {
              await Message.create({
                groupId: group._id,
                channelId,
                externalId: msg.externalId,
                sender: msg.sender,
                senderExternalId: msg.senderExternalId,
                content: msg.content,
                isFromBot: false,
                metadata: msg.metadata ?? {},
              });
            }
          }

          await EdgeAgentEvent.create({
            agentId: agent._id,
            eventType: "data_pushed",
            payload: {type: "messages", count: body.payload.messages.length},
          });

          res.json({received: body.payload.messages.length});
        } else if (body.type === "channel_request") {
          // Check if channel already exists for this agent
          if (agent.channelId) {
            const existingChannel = await Channel.findById(agent.channelId);
            if (existingChannel) {
              res.json({channelId: existingChannel._id.toString()});
              return;
            }
          }

          // Create Channel
          const channel = await Channel.create({
            name: body.payload.name,
            type: body.payload.channelType,
            status: "connected",
            config: body.payload.config ?? {},
          });

          // Create a default Group for this channel
          const externalId = `edge-${agent.agentType}-${agent._id}`;
          const defaultGroup = await Group.create({
            name: `${body.payload.name} — Default`,
            folder: `edge/${agent.agentType}/default`,
            channelId: channel._id,
            externalId,
            trigger: "",
            requiresTrigger: false,
            isMain: true,
          });

          // Connect the channel and cache the group in the live orchestrator
          // so inbound/outbound work without a restart.
          const orchestrator = getOrchestrator();
          if (orchestrator) {
            orchestrator.channelManager.registerGroup(defaultGroup);
            try {
              await orchestrator.channelManager.connectChannel(channel);
            } catch (err) {
              logger.error(`Failed to connect edge channel "${channel.name}": ${err}`);
            }
          }

          // Link the channel to the agent
          await EdgeAgent.findByIdAndUpdate(agent._id, {$set: {channelId: channel._id}});

          await EdgeAgentEvent.create({
            agentId: agent._id,
            eventType: "data_pushed",
            payload: {type: "channel_request", channelId: channel._id.toString()},
          });

          logger.info(
            `Channel created for edge agent "${agent.name}": ${channel.name} (${channel.type})`
          );

          res.status(201).json({channelId: channel._id.toString()});
        } else if (body.type === "reminders_sync") {
          const counts = await applyRemindersSync(agent._id, body.payload);

          await EdgeAgentEvent.create({
            agentId: agent._id,
            eventType: "data_pushed",
            payload: {
              type: "reminders_sync",
              lists: body.payload.lists.length,
              reminders: body.payload.reminders.length,
              removed: counts.removed,
            },
          });

          res.json({received: body.payload.reminders.length, removed: counts.removed});
        } else if (body.type === "calendar_sync") {
          const counts = await applyCalendarSync(agent._id, body.payload);

          await EdgeAgentEvent.create({
            agentId: agent._id,
            eventType: "data_pushed",
            payload: {
              type: "calendar_sync",
              calendars: body.payload.calendars.length,
              events: body.payload.events.length,
              removed: counts.removed,
            },
          });

          res.json({received: body.payload.events.length, removed: counts.removed});
        } else if (body.type === "events") {
          await EdgeAgentEvent.create({
            agentId: agent._id,
            eventType: "data_pushed",
            payload: {type: "events", data: body.payload},
          });

          res.json({received: true});
        }
      })
    );

    // ─── Admin-facing endpoints ───

    // POST /api/edge/agents/:id/approve
    app.post(
      "/api/edge/agents/:id/approve",
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const user = req.user as any;
        if (!user?.admin) {
          throw new APIError({status: 403, title: "Admin access required"});
        }

        const agent = await EdgeAgent.findExactlyOne({_id: req.params.id});

        if (agent.status !== "pending") {
          throw new APIError({
            status: 400,
            title: `Cannot approve agent in "${agent.status}" status`,
          });
        }

        await EdgeAgent.findByIdAndUpdate(agent._id, {
          $set: {
            status: "approved",
            approvedAt: new Date(),
            approvedBy: user._id,
          },
        });

        await EdgeAgentEvent.create({
          agentId: agent._id,
          eventType: "approved",
          payload: {approvedBy: user._id.toString()},
        });

        logger.info(`Edge agent "${agent.name}" approved by ${user.email || user._id}`);

        res.json({status: "approved"});
      })
    );

    // POST /api/edge/agents/:id/revoke
    app.post(
      "/api/edge/agents/:id/revoke",
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const user = req.user as any;
        if (!user?.admin) {
          throw new APIError({status: 403, title: "Admin access required"});
        }

        const agent = await EdgeAgent.findExactlyOne({_id: req.params.id});

        await EdgeAgent.findByIdAndUpdate(agent._id, {
          $set: {
            status: "pending",
            secrets: {},
            approvedAt: undefined,
            approvedBy: undefined,
          },
        });

        await EdgeAgentEvent.create({
          agentId: agent._id,
          eventType: "status_changed",
          payload: {from: agent.status, to: "pending", reason: "revoked"},
        });

        logger.info(`Edge agent "${agent.name}" revoked by ${user.email || user._id}`);

        res.json({status: "pending"});
      })
    );

    // POST /api/edge/agents/:id/command — queue a command
    app.post(
      "/api/edge/agents/:id/command",
      authenticateMiddleware(),
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const user = req.user as any;
        if (!user?.admin) {
          throw new APIError({status: 403, title: "Admin access required"});
        }

        const agent = await EdgeAgent.findExactlyOne({_id: req.params.id});

        const command = commandSchema.parse(req.body);
        const commandId = crypto.randomUUID();

        await EdgeAgent.findByIdAndUpdate(agent._id, {
          $push: {
            pendingCommands: {
              commandId,
              type: command.type,
              payload: command.payload,
              queuedAt: new Date(),
            },
          },
        });

        await EdgeAgentEvent.create({
          agentId: agent._id,
          eventType: "command_queued",
          payload: {commandId, type: command.type},
        });

        logger.info(
          `Command "${command.type}" queued for edge agent "${agent.name}" (${commandId})`
        );

        res.json({commandId});
      })
    );
  }
}
