import crypto from "node:crypto";
import {logger} from "@terreno/api";
import {EdgeAgent} from "../models/edgeAgent";
import {EdgeAgentEvent} from "../models/edgeAgentEvent";

export interface QueueEdgeCommandInput {
  capability: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface QueuedEdgeCommand {
  agentName: string;
  commandId: string;
}

/**
 * Queue a command on the most recently seen edge agent advertising the given
 * capability. The command is delivered on the agent's next heartbeat.
 */
export const queueEdgeCommand = async ({
  capability,
  type,
  payload,
}: QueueEdgeCommandInput): Promise<QueuedEdgeCommand> => {
  const agents = await EdgeAgent.find({
    capabilities: capability,
    status: {$in: ["approved", "online", "offline"]},
  })
    .sort({lastHeartbeatAt: -1})
    .limit(1);
  const agent = agents[0];

  if (!agent) {
    throw new Error(
      `No approved edge agent with capability "${capability}" is registered. ` +
        "Deploy/approve an iMessage edge agent (v0.2.0+) to use Apple Reminders/Calendar."
    );
  }

  const commandId = crypto.randomUUID();

  await EdgeAgent.findByIdAndUpdate(agent._id, {
    $push: {
      pendingCommands: {commandId, type, payload, queuedAt: new Date()},
    },
  });

  await EdgeAgentEvent.create({
    agentId: agent._id,
    eventType: "command_queued",
    payload: {commandId, type},
  });

  logger.info(`Command "${type}" queued for edge agent "${agent.name}" (${commandId})`);

  return {agentName: agent.name, commandId};
};
