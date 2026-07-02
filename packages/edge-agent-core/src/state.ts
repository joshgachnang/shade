import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AgentState {
  agentId: string;
  token: string;
  shadeUrl: string;
  registeredAt: string;
}

const STATE_DIR = path.join(os.homedir(), ".shade-agent");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const CONFIG_FILE = path.join(STATE_DIR, "config.json");

export const getStateDir = (): string => STATE_DIR;

export const readState = (): AgentState | null => {
  try {
    const data = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(data) as AgentState;
  } catch {
    return null;
  }
};

export const writeState = (state: AgentState): void => {
  fs.mkdirSync(STATE_DIR, {recursive: true});
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

export const readLocalConfig = <T = Record<string, unknown>>(): T | null => {
  try {
    const data = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
};

export const writeLocalConfig = (config: Record<string, unknown>): void => {
  fs.mkdirSync(STATE_DIR, {recursive: true});
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};
