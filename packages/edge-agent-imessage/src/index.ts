import os from "node:os";
import type {CommandResult, EdgeAgentConfig} from "@shade/edge-agent-types";
import {EdgeAgentBase, type HeartbeatCommand} from "@shade/edge-agent-core";
import {IMessageReader} from "./reader";
import {sendIMessage} from "./sender";

const VERSION = "0.1.0";

export class IMessageEdgeAgent extends EdgeAgentBase {
  private reader: IMessageReader | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private channelRequested = false;

  constructor() {
    const shadeUrl = process.env.SHADE_URL;
    const bootstrapSecret = process.env.SHADE_BOOTSTRAP_SECRET;
    const agentName = process.env.SHADE_AGENT_NAME || `imessage-${os.hostname()}`;

    if (!shadeUrl) {
      throw new Error("SHADE_URL environment variable is required");
    }
    if (!bootstrapSecret) {
      throw new Error("SHADE_BOOTSTRAP_SECRET environment variable is required");
    }

    super({
      name: agentName,
      agentType: "imessage",
      version: VERSION,
      capabilities: ["read_messages", "send_messages"],
      shadeUrl,
      bootstrapSecret,
    });
  }

  onConfig(config: EdgeAgentConfig, _secrets: Record<string, unknown>): void {
    console.info("Config updated");

    // Restart reader with new config
    this.stopPolling();

    const imessageConfig = config.imessage ?? {};
    this.reader = new IMessageReader(imessageConfig.dbPath, imessageConfig.chatFilters);

    try {
      this.reader.open();
      this.startPolling(config.pollIntervalMs ?? 5000);
    } catch (err) {
      console.error(`Failed to open iMessage database: ${err}`);
    }
  }

  async onCommand(command: HeartbeatCommand): Promise<CommandResult> {
    const startedAt = Date.now();

    if (command.type === "send_message") {
      const {to, text} = command.payload as {to: string; text: string};
      try {
        sendIMessage(to, text);
        return {
          commandId: command.commandId,
          success: true,
          completedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          commandId: command.commandId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date().toISOString(),
        };
      }
    }

    if (command.type === "update_config") {
      const {config} = command.payload as {config: EdgeAgentConfig};
      this.onConfig(config, this.secrets);
      return {
        commandId: command.commandId,
        success: true,
        completedAt: new Date().toISOString(),
      };
    }

    if (command.type === "restart") {
      console.info("Restart command received, restarting...");
      setTimeout(() => process.exit(0), 1000); // Let the response go out
      return {
        commandId: command.commandId,
        success: true,
        completedAt: new Date().toISOString(),
      };
    }

    if (command.type === "report_status") {
      return {
        commandId: command.commandId,
        success: true,
        completedAt: new Date().toISOString(),
      };
    }

    return {
      commandId: command.commandId,
      success: false,
      error: `Unknown command type: ${command.type}`,
      completedAt: new Date().toISOString(),
    };
  }

  async start(): Promise<void> {
    // Request channel creation if not done yet
    if (!this.channelRequested) {
      try {
        const agentName = this.options.name;
        await this.requestChannel("imessage", `${agentName} iMessage`);
        this.channelRequested = true;
        console.info("Channel request sent");
      } catch (err) {
        // Non-fatal — channel might already exist or agent not yet approved
        console.warn(`Channel request failed (may retry later): ${err}`);
      }
    }

    // Reader will be started when config arrives
    console.info("iMessage agent started, waiting for config...");
  }

  async stop(): Promise<void> {
    this.stopPolling();
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
  }

  private startPolling(intervalMs: number): void {
    this.pollTimer = setInterval(() => {
      this.pollAndPush().catch((err) => {
        console.error(`Poll error: ${err}`);
      });
    }, intervalMs);
    console.info(`Polling iMessages every ${intervalMs}ms`);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollAndPush(): Promise<void> {
    if (!this.reader) {
      return;
    }

    const messages = this.reader.poll();
    if (messages.length === 0) {
      return;
    }

    console.info(`Found ${messages.length} new message(s), pushing to Shade...`);

    try {
      await this.pushData({
        type: "messages",
        payload: {messages},
      });
    } catch (err) {
      console.error(`Failed to push messages: ${err}`);
    }
  }
}

// CLI entry point
if (import.meta.main) {
  const agent = new IMessageEdgeAgent();
  agent.run().catch((err) => {
    console.error(`Fatal: ${err}`);
    process.exit(1);
  });
}
