import type {ConfigResponse, EdgeAgentConfig} from "@shade/edge-agent-types";
import type {AgentState} from "./state";
import {readLocalConfig, writeLocalConfig} from "./state";

export type ConfigChangeHandler = (config: EdgeAgentConfig, secrets: Record<string, unknown>) => void;

export interface ConfigPollerOptions {
  state: AgentState;
  intervalMs: number;
  onChange: ConfigChangeHandler;
}

let configTimer: ReturnType<typeof setInterval> | null = null;
let lastConfigJson = "";

const fetchConfig = async (options: ConfigPollerOptions): Promise<void> => {
  try {
    const response = await fetch(`${options.state.shadeUrl}/api/edge/config`, {
      headers: {
        "X-Agent-Token": options.state.token,
      },
    });

    if (response.status === 403) {
      console.info("Agent not yet approved, waiting...");
      return;
    }

    if (!response.ok) {
      throw new Error(`Config fetch failed (${response.status})`);
    }

    const data = (await response.json()) as ConfigResponse;
    const configJson = JSON.stringify(data.config);

    // Persist to disk for offline resilience
    writeLocalConfig(data.config);

    // Detect changes
    if (configJson !== lastConfigJson) {
      lastConfigJson = configJson;
      options.onChange(data.config, data.secrets);
    }
  } catch (err) {
    console.error(`Config poll failed: ${err}`);

    // Fall back to local config on first run
    if (!lastConfigJson) {
      const local = readLocalConfig<EdgeAgentConfig>();
      if (local) {
        console.info("Using cached local config");
        lastConfigJson = JSON.stringify(local);
        options.onChange(local, {});
      }
    }
  }
};

export const startConfigPoller = (options: ConfigPollerOptions): void => {
  stopConfigPoller();

  // Fetch immediately
  fetchConfig(options).catch((err) => {
    console.error(`Initial config fetch failed: ${err}`);
  });

  configTimer = setInterval(() => {
    fetchConfig(options).catch((err) => {
      console.error(`Config poll error: ${err}`);
    });
  }, options.intervalMs);
};

export const stopConfigPoller = (): void => {
  if (configTimer) {
    clearInterval(configTimer);
    configTimer = null;
  }
};
