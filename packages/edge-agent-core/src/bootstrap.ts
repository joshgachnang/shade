import os from "node:os";
import type {RegistrationRequest, RegistrationResponse} from "@shade/edge-agent-types";
import {type AgentState, readState, writeState} from "./state";

export interface BootstrapOptions {
  name: string;
  agentType: string;
  version: string;
  capabilities?: string[];
  shadeUrl: string;
  bootstrapSecret: string;
}

export const bootstrap = async (options: BootstrapOptions): Promise<AgentState> => {
  // Check for existing state
  const existing = readState();
  if (existing) {
    console.info(`Agent already registered as ${existing.agentId}, skipping registration`);
    return existing;
  }

  console.info(`Registering with Shade at ${options.shadeUrl}...`);

  const body: RegistrationRequest = {
    name: options.name,
    agentType: options.agentType,
    platform: os.platform() as "darwin" | "linux" | "windows",
    arch: os.arch(),
    version: options.version,
    hostname: os.hostname(),
    capabilities: options.capabilities ?? [],
  };

  const response = await fetch(`${options.shadeUrl}/api/edge/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bootstrap-Secret": options.bootstrapSecret,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Registration failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as RegistrationResponse;

  const state: AgentState = {
    agentId: data.agentId,
    token: data.token,
    shadeUrl: options.shadeUrl,
    registeredAt: new Date().toISOString(),
  };

  writeState(state);
  console.info(`Registered as agent ${data.agentId}`);

  return state;
};
