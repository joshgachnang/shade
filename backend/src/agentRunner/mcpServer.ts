import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import {createSdkMcpServer, tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";
import {Message} from "../models/message";
import {ScheduledTask} from "../models/scheduledTask";
import {
  addShadeContext,
  createContact,
  getContactById,
  matchContactByEmail,
  matchContactByPhone,
  searchContacts,
  updateContact,
} from "../utils/appleContacts";

const execFileAsync = promisify(execFile);

interface McpContext {
  groupId: string;
  channelId: string;
  ipcDir: string;
  groupFolder: string;
  messageTs?: string;
  senderExternalId?: string;
}

const writeIpcFile = async (ipcDir: string, data: Record<string, unknown>): Promise<string> => {
  await fs.mkdir(ipcDir, {recursive: true});

  const fileId = randomUUID();
  const tmpPath = path.join(ipcDir, `${fileId}.tmp`);
  const finalPath = path.join(ipcDir, `${fileId}.json`);

  await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await fs.rename(tmpPath, finalPath);

  return fileId;
};

const buildTools = (ctx: McpContext) => {
  const sendMessageTool = tool(
    "send_message",
    "Send a message to a channel. Use this to respond to users or communicate with other groups.",
    {
      content: z.string().describe("The message content to send"),
      targetGroupId: z
        .string()
        .optional()
        .describe("Target group ID. Omit to send to the current group."),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "send_message",
        groupId: ctx.groupId,
        channelId: ctx.channelId,
        content: args.content,
        targetGroupId: args.targetGroupId,
      });
      return {
        content: [{type: "text" as const, text: `Message queued (${fileId})`}],
      };
    }
  );

  const addReactionTool = tool(
    "add_reaction",
    "Add an emoji reaction to a message. If no messageTs is provided, reacts to the message that triggered this agent run.",
    {
      emoji: z
        .string()
        .describe("Emoji name without colons (e.g., 'eyes', 'thumbsup', 'white_check_mark')"),
      messageTs: z
        .string()
        .optional()
        .describe("Message timestamp to react to. Omit to react to the triggering message."),
    },
    async (args) => {
      const ts = args.messageTs ?? ctx.messageTs;
      if (!ts) {
        return {
          content: [
            {type: "text" as const, text: "Error: No message timestamp available to react to."},
          ],
        };
      }
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "add_reaction",
        groupId: ctx.groupId,
        channelId: ctx.channelId,
        messageTs: ts,
        emoji: args.emoji,
      });
      return {
        content: [{type: "text" as const, text: `Reaction queued (${fileId})`}],
      };
    }
  );

  const scheduleTaskTool = tool(
    "schedule_task",
    "Schedule a new recurring or one-time task for this group.",
    {
      name: z.string().describe("Task name"),
      prompt: z.string().describe("The prompt/instruction for the task"),
      scheduleType: z.enum(["cron", "interval", "once"]).describe("Schedule type"),
      schedule: z.string().describe("Cron expression, interval in ms, or ISO date for once"),
      classification: z
        .enum(["public", "internal", "sensitive", "critical"])
        .default("internal")
        .describe("Security classification"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "create_task",
        groupId: ctx.groupId,
        data: {
          name: args.name,
          prompt: args.prompt,
          scheduleType: args.scheduleType,
          schedule: args.schedule,
          classification: args.classification,
          status: "active",
        },
      });
      return {
        content: [{type: "text" as const, text: `Task scheduled (${fileId})`}],
      };
    }
  );

  const listTasksTool = tool(
    "list_tasks",
    "List scheduled tasks for the current group. Returns task details including name, schedule, status, and last/next run times.",
    {
      status: z
        .enum(["active", "paused", "completed", "cancelled"])
        .optional()
        .describe("Filter by status"),
    },
    async (args) => {
      const filter: Record<string, string> = {groupId: ctx.groupId};
      if (args.status) {
        filter.status = args.status;
      }

      const tasks = await ScheduledTask.find(filter).sort({created: -1}).limit(50).lean();

      if (tasks.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: args.status
                ? `No ${args.status} tasks found for this group.`
                : "No scheduled tasks found for this group.",
            },
          ],
        };
      }

      const taskList = tasks.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        scheduleType: t.scheduleType,
        schedule: t.schedule,
        status: t.status,
        classification: t.classification,
        nextRunAt: t.nextRunAt?.toISOString() ?? null,
        lastRunAt: t.lastRunAt?.toISOString() ?? null,
        runCount: t.runCount,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(taskList, null, 2),
          },
        ],
      };
    }
  );

  const pauseTaskTool = tool(
    "pause_task",
    "Pause an active scheduled task.",
    {
      taskId: z.string().describe("The task ID to pause"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "pause_task",
        groupId: ctx.groupId,
        taskId: args.taskId,
      });
      return {
        content: [{type: "text" as const, text: `Task pause queued (${fileId})`}],
      };
    }
  );

  const resumeTaskTool = tool(
    "resume_task",
    "Resume a paused scheduled task.",
    {
      taskId: z.string().describe("The task ID to resume"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "resume_task",
        groupId: ctx.groupId,
        taskId: args.taskId,
      });
      return {
        content: [{type: "text" as const, text: `Task resume queued (${fileId})`}],
      };
    }
  );

  const cancelTaskTool = tool(
    "cancel_task",
    "Cancel a scheduled task.",
    {
      taskId: z.string().describe("The task ID to cancel"),
    },
    async (args) => {
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "cancel_task",
        groupId: ctx.groupId,
        taskId: args.taskId,
      });
      return {
        content: [{type: "text" as const, text: `Task cancel queued (${fileId})`}],
      };
    }
  );

  const getWeatherTool = tool(
    "get_weather",
    "Get current weather information for a location using wttr.in free API. Returns temperature, conditions, humidity, wind, and more.",
    {
      location: z
        .string()
        .describe(
          "City name, airport code, or 'here' for IP-based location (e.g., 'London', 'SFO', 'New York')"
        ),
      format: z
        .enum(["short", "detailed"])
        .default("detailed")
        .describe("Response format: 'short' for one-line summary, 'detailed' for full info"),
    },
    async (args) => {
      try {
        // Use wttr.in free weather API
        const location = encodeURIComponent(args.location);
        const url =
          args.format === "short"
            ? `https://wttr.in/${location}?format=%l:+%C+%t+%w+%h`
            : `https://wttr.in/${location}?format=j1`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Weather API returned ${response.status}`);
        }

        const data = await response.text();

        if (args.format === "short") {
          return {
            content: [{type: "text" as const, text: data}],
          };
        }

        // Parse JSON response for detailed format
        const weatherData = JSON.parse(data);
        const current = weatherData.current_condition[0];
        const area = weatherData.nearest_area[0];

        const formatted = [
          `📍 Location: ${area.areaName[0].value}, ${area.country[0].value}`,
          `🌡️  Temperature: ${current.temp_C}°C (${current.temp_F}°F)`,
          `🌤️  Conditions: ${current.weatherDesc[0].value}`,
          `💨 Wind: ${current.windspeedKmph} km/h ${current.winddir16Point}`,
          `💧 Humidity: ${current.humidity}%`,
          `👁️  Visibility: ${current.visibility} km`,
          `🌡️  Feels Like: ${current.FeelsLikeC}°C (${current.FeelsLikeF}°F)`,
          `☔ Precipitation: ${current.precipMM} mm`,
        ].join("\n");

        return {
          content: [{type: "text" as const, text: formatted}],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error fetching weather";
        return {
          content: [{type: "text" as const, text: `Error: ${errorMsg}`}],
        };
      }
    }
  );

  const getChannelHistoryTool = tool(
    "get_channel_history",
    "Fetch older messages from the current channel for additional context. Returns messages in chronological order.",
    {
      limit: z
        .number()
        .min(1)
        .max(100)
        .default(20)
        .describe("Number of messages to fetch (default 20, max 100)"),
      before: z
        .string()
        .optional()
        .describe(
          "Fetch messages before this ISO date string. Omit to get the most recent messages."
        ),
    },
    async (args) => {
      const query: Record<string, unknown> = {groupId: ctx.groupId};
      if (args.before) {
        query.created = {$lt: new Date(args.before)};
      }

      const messages = await Message.find(query).sort({created: -1}).limit(args.limit);

      // Reverse to chronological order
      messages.reverse();

      if (messages.length === 0) {
        return {
          content: [{type: "text" as const, text: "No messages found."}],
        };
      }

      const formatted = messages
        .map((msg) => {
          const role = msg.isFromBot ? "assistant" : "user";
          const sender = msg.isFromBot ? "Shade" : msg.sender;
          const time = new Date(msg.created).toISOString();
          return `[${time}] ${role} (${sender}): ${msg.content}`;
        })
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Channel history (${messages.length} messages):\n${formatted}`,
          },
        ],
      };
    }
  );

  const STORE_DIR = "store";

  const getStorePath = (key: string): string => {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(ctx.groupFolder, STORE_DIR, `${safeKey}.json`);
  };

  const saveDataTool = tool(
    "save_data",
    "Save a named piece of data to persistent storage for this group. Data persists across sessions. Use for RSS feed lists, preferences, configuration, etc.",
    {
      key: z.string().describe("A unique name for this data (alphanumeric, hyphens, underscores)"),
      data: z.string().describe("The data to store (use JSON for structured data)"),
    },
    async (args) => {
      const storePath = getStorePath(args.key);
      await fs.mkdir(path.dirname(storePath), {recursive: true});
      await fs.writeFile(
        storePath,
        JSON.stringify({key: args.key, data: args.data, updatedAt: new Date().toISOString()}),
        "utf-8"
      );
      return {
        content: [{type: "text" as const, text: `Data saved with key "${args.key}".`}],
      };
    }
  );

  const loadDataTool = tool(
    "load_data",
    "Load a previously saved piece of data by key.",
    {
      key: z.string().describe("The key of the data to load"),
    },
    async (args) => {
      const storePath = getStorePath(args.key);
      try {
        const content = await fs.readFile(storePath, "utf-8");
        const parsed = JSON.parse(content);
        return {
          content: [{type: "text" as const, text: parsed.data}],
        };
      } catch {
        return {
          content: [{type: "text" as const, text: `No data found for key "${args.key}".`}],
        };
      }
    }
  );

  const listDataTool = tool(
    "list_data",
    "List all saved data keys for this group.",
    {},
    async () => {
      const storeDir = path.join(ctx.groupFolder, STORE_DIR);
      try {
        const files = await fs.readdir(storeDir);
        const keys = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
        if (keys.length === 0) {
          return {content: [{type: "text" as const, text: "No saved data found."}]};
        }
        return {content: [{type: "text" as const, text: keys.join("\n")}]};
      } catch {
        return {content: [{type: "text" as const, text: "No saved data found."}]};
      }
    }
  );

  // --- Apple Reminders tools (macOS only, uses JXA via osascript) ---

  const runJxa = async (script: string): Promise<string> => {
    const {stdout} = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
      timeout: 15_000,
    });
    return stdout.trim();
  };

  const listReminderListsTool = tool(
    "list_reminder_lists",
    "List all Apple Reminders lists on this Mac. Returns list names and their reminder counts.",
    {},
    async () => {
      try {
        const script = `
          const app = Application("Reminders");
          const lists = app.lists();
          JSON.stringify(lists.map(l => ({
            name: l.name(),
            id: l.id(),
            count: l.reminders.whose({completed: false})().length
          })));
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing reminder lists: ${msg}`}]};
      }
    }
  );

  const deleteDataTool = tool(
    "delete_data",
    "Delete a saved piece of data by key.",
    {
      key: z.string().describe("The key of the data to delete"),
    },
    async (args) => {
      const storePath = getStorePath(args.key);
      try {
        await fs.unlink(storePath);
        return {content: [{type: "text" as const, text: `Data "${args.key}" deleted.`}]};
      } catch {
        return {
          content: [{type: "text" as const, text: `No data found for key "${args.key}".`}],
        };
      }
    }
  );

  const listRemindersTool = tool(
    "list_reminders",
    "List reminders from an Apple Reminders list. Returns reminder names, due dates, priorities, and completion status.",
    {
      listName: z.string().describe("Name of the reminders list (e.g., 'Reminders', 'Shopping')"),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe("Include completed reminders (default: false)"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const reminders = ${args.includeCompleted ? "list.reminders()" : "list.reminders.whose({completed: false})()"};
          JSON.stringify(reminders.map(r => ({
            name: r.name(),
            id: r.id(),
            completed: r.completed(),
            dueDate: r.dueDate() ? r.dueDate().toISOString() : null,
            priority: r.priority(),
            body: r.body() || null
          })));
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error listing reminders: ${msg}`}]};
      }
    }
  );

  const createFeatureTool = tool(
    "create_feature",
    "Create a new Slack channel for a focused feature discussion. Creates the channel, invites the requesting user, and sets up a new Shade group for it. Use this when someone wants to start working on a new feature.",
    {
      name: z
        .string()
        .describe(
          "Short feature name in kebab-case (e.g., 'zoom-integration', 'rss-reader'). Used as the Slack channel name with a 'feat-' prefix."
        ),
      description: z
        .string()
        .optional()
        .describe("Brief description of the feature for the channel topic"),
    },
    async (args) => {
      if (!ctx.senderExternalId) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No sender information available to invite to the channel.",
            },
          ],
        };
      }
      const channelName = `feat-${args.name}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 80);
      const fileId = await writeIpcFile(ctx.ipcDir, {
        type: "create_feature",
        groupId: ctx.groupId,
        channelId: ctx.channelId,
        name: channelName,
        description: args.description,
        senderExternalId: ctx.senderExternalId,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Feature channel creation queued (${fileId}). Creating #${channelName} and inviting you...`,
          },
        ],
      };
    }
  );

  const createReminderTool = tool(
    "create_reminder",
    "Create a new reminder in Apple Reminders. Supports setting name, due date, priority, notes, and target list.",
    {
      name: z.string().describe("The reminder title"),
      listName: z.string().default("Reminders").describe("Target list name (default: 'Reminders')"),
      notes: z.string().optional().describe("Body/notes for the reminder"),
      dueDate: z
        .string()
        .optional()
        .describe("Due date as ISO 8601 string (e.g., '2025-12-25T09:00:00')"),
      priority: z
        .number()
        .min(0)
        .max(9)
        .default(0)
        .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const nameEscaped = args.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const notesEscaped = args.notes
          ? args.notes.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
          : "";

        let dueDateJs = "null";
        if (args.dueDate) {
          dueDateJs = `new Date("${args.dueDate}")`;
        }

        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const props = {
            name: "${nameEscaped}",
            priority: ${args.priority}
          };
          ${args.notes ? `props.body = "${notesEscaped}";` : ""}
          const dueDate = ${dueDateJs};
          if (dueDate) { props.dueDate = dueDate; }
          const r = app.Reminder(props);
          list.reminders.push(r);
          JSON.stringify({id: r.id(), name: r.name()});
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: `Reminder created: ${result}`}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error creating reminder: ${msg}`}]};
      }
    }
  );

  const completeReminderTool = tool(
    "complete_reminder",
    "Mark an Apple Reminder as completed by its name and list.",
    {
      name: z.string().describe("The exact name of the reminder to complete"),
      listName: z
        .string()
        .default("Reminders")
        .describe("The list containing the reminder (default: 'Reminders')"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const nameEscaped = args.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const matches = list.reminders.whose({name: "${nameEscaped}", completed: false})();
          if (matches.length === 0) {
            JSON.stringify({error: "No matching incomplete reminder found"});
          } else {
            matches[0].completed = true;
            JSON.stringify({completed: true, name: matches[0].name()});
          }
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error completing reminder: ${msg}`}]};
      }
    }
  );

  const deleteReminderTool = tool(
    "delete_reminder",
    "Delete an Apple Reminder by its name and list. This permanently removes the reminder.",
    {
      name: z.string().describe("The exact name of the reminder to delete"),
      listName: z
        .string()
        .default("Reminders")
        .describe("The list containing the reminder (default: 'Reminders')"),
    },
    async (args) => {
      try {
        const listNameEscaped = args.listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const nameEscaped = args.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = `
          const app = Application("Reminders");
          const list = app.lists.byName("${listNameEscaped}");
          const matches = list.reminders.whose({name: "${nameEscaped}"})();
          if (matches.length === 0) {
            JSON.stringify({error: "No matching reminder found"});
          } else {
            app.delete(matches[0]);
            JSON.stringify({deleted: true, name: "${nameEscaped}"});
          }
        `;
        const result = await runJxa(script);
        return {content: [{type: "text" as const, text: result}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error deleting reminder: ${msg}`}]};
      }
    }
  );

  // --- Apple Contacts tools ---

  const searchContactsTool = tool(
    "search_contacts",
    "Search Apple Contacts by name, email, phone number, company, or notes. Use this to find contacts when processing messages — match senders to known contacts for context.",
    {
      query: z
        .string()
        .describe(
          "Search query: a name, email address, phone number, company name, or keyword from notes"
        ),
    },
    async (args) => {
      try {
        const contacts = await searchContacts(args.query);
        if (contacts.length === 0) {
          return {
            content: [{type: "text" as const, text: `No contacts found matching "${args.query}"`}],
          };
        }
        return {content: [{type: "text" as const, text: JSON.stringify(contacts, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error searching contacts: ${msg}`}]};
      }
    }
  );

  const getContactTool = tool(
    "get_contact",
    "Get full details for a specific Apple Contact by ID, including all emails, phones, addresses, and Shade context notes.",
    {
      id: z.string().describe("The Apple Contacts ID of the person"),
    },
    async (args) => {
      try {
        const contact = await getContactById(args.id);
        if (!contact) {
          return {content: [{type: "text" as const, text: "Contact not found"}]};
        }
        return {content: [{type: "text" as const, text: JSON.stringify(contact, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error getting contact: ${msg}`}]};
      }
    }
  );

  const matchContactTool = tool(
    "match_contact",
    "Match an incoming message sender to an Apple Contact using their email address or phone number. Returns the full contact if found, or null. Use this when processing emails or texts to identify who is messaging.",
    {
      email: z.string().optional().describe("Email address to match"),
      phone: z.string().optional().describe("Phone number to match (any format)"),
    },
    async (args) => {
      try {
        let contact = null;
        if (args.email) {
          contact = await matchContactByEmail(args.email);
        }
        if (!contact && args.phone) {
          contact = await matchContactByPhone(args.phone);
        }
        if (!contact) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No contact found for ${args.email ? `email: ${args.email}` : ""}${args.email && args.phone ? ", " : ""}${args.phone ? `phone: ${args.phone}` : ""}`,
              },
            ],
          };
        }
        return {content: [{type: "text" as const, text: JSON.stringify(contact, null, 2)}]};
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error matching contact: ${msg}`}]};
      }
    }
  );

  const createContactTool = tool(
    "create_contact",
    "Create a new contact in Apple Contacts. Use when you encounter a new person who should be tracked.",
    {
      firstName: z.string().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      company: z.string().optional().describe("Company/organization name"),
      jobTitle: z.string().optional().describe("Job title"),
      emails: z
        .array(z.object({label: z.string(), value: z.string()}))
        .optional()
        .describe('Email addresses with labels (e.g., [{label: "work", value: "j@co.com"}])'),
      phones: z
        .array(z.object({label: z.string(), value: z.string()}))
        .optional()
        .describe('Phone numbers with labels (e.g., [{label: "mobile", value: "+15551234567"}])'),
      note: z.string().optional().describe("Free-form notes about this person"),
    },
    async (args) => {
      try {
        const contact = await createContact({
          firstName: args.firstName,
          lastName: args.lastName,
          company: args.company,
          jobTitle: args.jobTitle,
          emails: args.emails,
          phones: args.phones,
          note: args.note,
        });
        return {
          content: [
            {type: "text" as const, text: `Contact created: ${JSON.stringify(contact, null, 2)}`},
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error creating contact: ${msg}`}]};
      }
    }
  );

  const updateContactTool = tool(
    "update_contact",
    "Update an existing Apple Contact's basic fields (name, company, job title, or full note text).",
    {
      id: z.string().describe("The Apple Contacts ID"),
      firstName: z.string().optional().describe("Updated first name"),
      lastName: z.string().optional().describe("Updated last name"),
      company: z.string().optional().describe("Updated company name"),
      jobTitle: z.string().optional().describe("Updated job title"),
      note: z
        .string()
        .optional()
        .describe("Replace the full note text (use add_contact_context for incremental updates)"),
    },
    async (args) => {
      try {
        const contact = await updateContact({
          id: args.id,
          firstName: args.firstName,
          lastName: args.lastName,
          company: args.company,
          jobTitle: args.jobTitle,
          note: args.note,
        });
        return {
          content: [
            {type: "text" as const, text: `Contact updated: ${JSON.stringify(contact, null, 2)}`},
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error updating contact: ${msg}`}]};
      }
    }
  );

  const addContactContextTool = tool(
    "add_contact_context",
    "Add or update structured Shade context in a contact's notes. This merges new information with existing context — interests, topics, and preferences are additive (won't remove existing ones). Recent updates are appended. Use this to continuously enrich contacts with things you learn from conversations.",
    {
      id: z.string().describe("The Apple Contacts ID"),
      relationship: z
        .string()
        .optional()
        .describe('Relationship type (e.g., "coworker", "friend", "manager", "client")'),
      metAt: z
        .string()
        .optional()
        .describe('How/where you met (e.g., "2025-03 tech conference in SF")'),
      interests: z
        .array(z.string())
        .optional()
        .describe('Hobbies and interests (e.g., ["hiking", "photography", "ML"])'),
      topics: z
        .array(z.string())
        .optional()
        .describe(
          'Current work/life topics (e.g., ["working on search feature", "learning Rust"])'
        ),
      preferences: z
        .array(z.string())
        .optional()
        .describe(
          'Communication preferences (e.g., ["prefers morning meetings", "likes concise emails"])'
        ),
      recentUpdates: z
        .array(z.string())
        .optional()
        .describe(
          'Recent life/work updates with date context (e.g., ["got promoted to staff engineer (2025-06)"])'
        ),
      customFields: z
        .record(z.string(), z.string())
        .optional()
        .describe("Any other key-value pairs to store"),
    },
    async (args) => {
      try {
        const contact = await addShadeContext(args.id, {
          relationship: args.relationship,
          metAt: args.metAt,
          interests: args.interests,
          topics: args.topics,
          preferences: args.preferences,
          recentUpdates: args.recentUpdates,
          customFields: args.customFields,
        });
        return {
          content: [
            {type: "text" as const, text: `Context added to ${contact.fullName}:\n${contact.note}`},
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error adding context: ${msg}`}]};
      }
    }
  );

  return [
    sendMessageTool,
    addReactionTool,
    createFeatureTool,
    scheduleTaskTool,
    listTasksTool,
    pauseTaskTool,
    resumeTaskTool,
    cancelTaskTool,
    getWeatherTool,
    getChannelHistoryTool,
    saveDataTool,
    loadDataTool,
    listDataTool,
    deleteDataTool,
    listReminderListsTool,
    listRemindersTool,
    createReminderTool,
    completeReminderTool,
    deleteReminderTool,
    searchContactsTool,
    getContactTool,
    matchContactTool,
    createContactTool,
    updateContactTool,
    addContactContextTool,
  ];
};

export const createShadeMcpServer = (ctx: McpContext) => {
  return createSdkMcpServer({
    name: "shade-orchestrator",
    version: "1.0.0",
    tools: buildTools(ctx),
  });
};
