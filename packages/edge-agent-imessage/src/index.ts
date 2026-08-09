import os from "node:os";
import type {CommandResult, EdgeAgentConfig} from "@shade/edge-agent-types";
import {EdgeAgentBase, type HeartbeatCommand} from "@shade/edge-agent-core";
import {createCalendarEvent} from "./appleCalendar";
import {completeReminder, createReminder, deleteReminder} from "./appleReminders";
import {IMessageReader} from "./reader";
import {type MessageService, sendIMessage} from "./sender";
import {AppleSyncService} from "./sync";

const VERSION = "0.2.0";

export class IMessageEdgeAgent extends EdgeAgentBase {
  private reader: IMessageReader | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private channelRequested = false;
  private syncService = new AppleSyncService({pushData: (data) => this.pushData(data)});

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
      capabilities: [
        "read_messages",
        "send_messages",
        "sync_reminders",
        "sync_calendar",
        "manage_reminders",
        "manage_calendar",
      ],
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

    // Full reminders + calendar sync on launch/config, then on an interval
    this.syncService.start(config);
  }

  async onCommand(command: HeartbeatCommand): Promise<CommandResult> {
    const startedAt = Date.now();

    if (command.type === "send_message") {
      const {to, text} = command.payload as {to: string; text: string};
      try {
        // Reply over the service the conversation actually uses — an iMessage
        // send to an SMS/RCS-only contact fails async with "Not Delivered"
        // (SMS covers RCS chats too; both relay through the paired iPhone).
        const chatService = this.reader?.getServiceForChat(to) ?? null;
        const service: MessageService =
          chatService && chatService !== "iMessage" ? "SMS" : "iMessage";
        sendIMessage(to, text, service);
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

    if (command.type === "create_reminder") {
      const payload = command.payload as {
        title: string;
        listName?: string;
        notes?: string;
        dueDate?: string;
        priority?: number;
      };
      return this.runCommand(command, async () => {
        const created = await createReminder(payload);
        console.info(`Reminder created in "${created.listName}" (${created.externalId})`);
        await this.syncService.syncReminders();
        return created;
      });
    }

    if (command.type === "complete_reminder") {
      const {externalId} = command.payload as {externalId: string};
      return this.runCommand(command, async () => {
        await completeReminder(externalId);
        await this.syncService.syncReminders();
        return {externalId};
      });
    }

    if (command.type === "delete_reminder") {
      const {externalId} = command.payload as {externalId: string};
      return this.runCommand(command, async () => {
        await deleteReminder(externalId);
        await this.syncService.syncReminders();
        return {externalId};
      });
    }

    if (command.type === "create_calendar_event") {
      const payload = command.payload as {
        title: string;
        calendarName?: string;
        startDate: string;
        endDate: string;
        allDay?: boolean;
        location?: string;
        notes?: string;
      };
      return this.runCommand(command, async () => {
        const created = await createCalendarEvent(payload);
        console.info(`Event created in "${created.calendarName}" (${created.externalId})`);
        const calendarConfig = this.config?.calendar;
        await this.syncService.syncCalendar(
          calendarConfig?.daysAhead ?? 90,
          calendarConfig?.calendarFilters
        );
        return created;
      });
    }

    if (command.type === "sync_now") {
      return this.runCommand(command, async () => {
        if (!this.config) {
          throw new Error("No config received yet");
        }
        await this.syncService.syncAll(this.config);
        return {synced: true};
      });
    }

    return {
      commandId: command.commandId,
      success: false,
      error: `Unknown command type: ${command.type}`,
      completedAt: new Date().toISOString(),
    };
  }

  private async runCommand(
    command: HeartbeatCommand,
    fn: () => Promise<unknown>
  ): Promise<CommandResult> {
    try {
      await fn();
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
    this.syncService.stop();
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
