import type {CommandResult, DataPush, EdgeAgentConfig} from "@shade/edge-agent-types";
import {type BootstrapOptions, bootstrap} from "./bootstrap";
import {startConfigPoller, stopConfigPoller} from "./config";
import {
  type HeartbeatCommand,
  startHeartbeatLoop,
  stopHeartbeatLoop,
} from "./heartbeat";
import type {AgentState} from "./state";

export interface EdgeAgentOptions extends BootstrapOptions {
  defaultConfig?: Partial<EdgeAgentConfig>;
}

export abstract class EdgeAgentBase {
  protected state: AgentState | null = null;
  protected config: EdgeAgentConfig | null = null;
  protected secrets: Record<string, unknown> = {};
  protected options: EdgeAgentOptions;
  private running = false;

  constructor(options: EdgeAgentOptions) {
    this.options = options;
  }

  abstract onConfig(config: EdgeAgentConfig, secrets: Record<string, unknown>): void;
  abstract onCommand(command: HeartbeatCommand): Promise<CommandResult>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  async run(): Promise<void> {
    // Register signal handlers
    const shutdown = async () => {
      console.info("Shutting down...");
      await this.shutdown();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // Bootstrap (register or load existing state)
    this.state = await bootstrap(this.options);
    this.running = true;

    // Start heartbeat
    const heartbeatInterval = this.config?.heartbeatIntervalMs ?? 30000;
    startHeartbeatLoop({
      state: this.state,
      intervalMs: heartbeatInterval,
      version: this.options.version,
      onCommand: async (cmd) => this.onCommand(cmd),
    });

    // Start config polling
    const configInterval = this.config?.configPollIntervalMs ?? 60000;
    startConfigPoller({
      state: this.state,
      intervalMs: configInterval,
      onChange: (config, secrets) => {
        this.config = config;
        this.secrets = secrets;
        this.onConfig(config, secrets);
      },
    });

    // Start the agent-specific logic
    await this.start();

    console.info("Edge agent running");
  }

  async pushData(data: DataPush): Promise<void> {
    if (!this.state) {
      throw new Error("Agent not initialized");
    }

    const response = await fetch(`${this.state.shadeUrl}/api/edge/data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.state.token}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Data push failed (${response.status}): ${text}`);
    }
  }

  async requestChannel(channelType: string, name: string): Promise<string> {
    const response = await this.pushData({
      type: "channel_request",
      payload: {channelType, name},
    } as DataPush);

    // pushData doesn't return body, so make the request directly
    if (!this.state) {
      throw new Error("Agent not initialized");
    }

    const res = await fetch(`${this.state.shadeUrl}/api/edge/data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.state.token}`,
      },
      body: JSON.stringify({
        type: "channel_request",
        payload: {channelType, name},
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Channel request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {channelId: string};
    return data.channelId;
  }

  async shutdown(): Promise<void> {
    this.running = false;
    stopHeartbeatLoop();
    stopConfigPoller();
    await this.stop();
    console.info("Edge agent shut down");
  }

  isRunning(): boolean {
    return this.running;
  }
}
