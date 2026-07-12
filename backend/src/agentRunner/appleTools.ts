import {tool} from "@anthropic-ai/claude-agent-sdk";
import {DateTime} from "luxon";
import {z} from "zod";
import {queueEdgeCommand} from "../edge/commands";
import {AppleCalendar} from "../models/appleCalendarModel";
import {CalendarEvent} from "../models/calendarEvent";
import {Reminder} from "../models/reminder";
import {ReminderList} from "../models/reminderList";

interface TargetCandidate {
  name: string;
  description?: string;
  isDefault: boolean;
}

const describeCandidates = (candidates: TargetCandidate[]): string => {
  return candidates
    .map((c) => {
      const parts = [c.name];
      if (c.isDefault) {
        parts.push("(default)");
      }
      if (c.description) {
        parts.push(`— ${c.description}`);
      }
      return parts.join(" ");
    })
    .join("\n");
};

/**
 * Resolve a requested list/calendar name against synced candidates.
 * Matching order: exact (case-insensitive) → substring. When no name is
 * requested, falls back to the candidate marked isDefault; if none is marked,
 * returns undefined so the Mac's own default is used.
 */
export const resolveTargetName = (
  requested: string | undefined,
  candidates: TargetCandidate[]
): {match?: string; error?: string} => {
  if (!requested) {
    const defaultCandidate = candidates.find((c) => c.isDefault);
    return {match: defaultCandidate?.name};
  }

  const lower = requested.toLowerCase();
  const exact = candidates.find((c) => c.name.toLowerCase() === lower);
  if (exact) {
    return {match: exact.name};
  }

  const partial = candidates.filter(
    (c) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())
  );
  if (partial.length === 1) {
    return {match: partial[0].name};
  }

  return {
    error:
      `No match for "${requested}". Available:\n${describeCandidates(candidates)}\n` +
      "Pick the best fit based on the descriptions, or omit the name to use the default.",
  };
};

const formatDate = (date: Date | undefined | null): string | null => {
  if (!date) {
    return null;
  }
  return DateTime.fromJSDate(date).toISO();
};

// Exported for tests; production code uses buildAppleTools via createShadeMcpServer.
export const buildAppleTools = () => {
  const listReminderListsTool = tool(
    "list_reminder_lists",
    "List all Apple Reminders lists (synced from the Mac by the edge agent), including each list's " +
      "purpose description and open-reminder count. Check this before creating a reminder when unsure " +
      "which list fits — the descriptions explain what each list is for.",
    {},
    async () => {
      const lists = await ReminderList.find({}).sort({name: 1}).lean();
      if (lists.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No reminder lists synced yet. Is the iMessage edge agent running and approved?",
            },
          ],
        };
      }
      const counts = await Reminder.aggregate([
        {$match: {syncStatus: "active", completed: false}},
        {$group: {_id: "$listExternalId", count: {$sum: 1}}},
      ]);
      const countByList = new Map<string, number>(counts.map((c) => [c._id as string, c.count]));
      const result = lists.map((l) => ({
        name: l.name,
        description: l.description ?? null,
        isDefault: l.isDefault,
        openReminders: countByList.get(l.externalId) ?? 0,
        lastSyncedAt: formatDate(l.lastSyncedAt),
      }));
      return {content: [{type: "text" as const, text: JSON.stringify(result, null, 2)}]};
    }
  );

  const listRemindersTool = tool(
    "list_reminders",
    "List reminders synced from Apple Reminders. Returns title, list, due date, priority, and notes.",
    {
      listName: z.string().optional().describe("Filter by list name. Omit for all lists."),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe("Include reminders completed/removed since syncing began (default: false)"),
    },
    async (args) => {
      const filter: Record<string, unknown> = {};
      if (!args.includeCompleted) {
        filter.syncStatus = "active";
        filter.completed = false;
      }
      if (args.listName) {
        filter.listName = new RegExp(
          `^${args.listName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        );
      }
      const reminders = await Reminder.find(filter).sort({dueDate: 1, title: 1}).limit(200).lean();
      if (reminders.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: args.listName
                ? `No reminders found in list "${args.listName}".`
                : "No reminders found.",
            },
          ],
        };
      }
      const result = reminders.map((r) => ({
        title: r.title,
        list: r.listName,
        dueDate: formatDate(r.dueDate),
        priority: r.priority,
        notes: r.notes ?? null,
        completed: r.completed,
        syncStatus: r.syncStatus,
      }));
      return {content: [{type: "text" as const, text: JSON.stringify(result, null, 2)}]};
    }
  );

  const createReminderTool = tool(
    "create_reminder",
    "Create a reminder in Apple Reminders (executed on the Mac by the edge agent). " +
      "If the user didn't name a list, guess the right one: call list_reminder_lists and match the " +
      "item to a list using the list descriptions (e.g. groceries go to a shopping list). Omit " +
      "listName only when nothing fits — that uses the default list.",
    {
      name: z.string().describe("The reminder title"),
      listName: z.string().optional().describe("Target list name. Omit to use the default list."),
      notes: z.string().optional().describe("Body/notes for the reminder"),
      dueDate: z
        .string()
        .optional()
        .describe(
          "Due date as ISO 8601 (e.g. '2026-07-12T09:00:00'). Timezone-less values use the Mac's local timezone."
        ),
      priority: z
        .number()
        .min(0)
        .max(9)
        .default(0)
        .describe("Priority: 0=none, 1-4=high, 5=medium, 6-9=low"),
    },
    async (args) => {
      try {
        const lists = await ReminderList.find({}).lean();
        const resolved = resolveTargetName(args.listName, lists);
        if (resolved.error) {
          return {content: [{type: "text" as const, text: resolved.error}]};
        }

        const {agentName, commandId} = await queueEdgeCommand({
          capability: "manage_reminders",
          type: "create_reminder",
          payload: {
            title: args.name,
            listName: resolved.match,
            notes: args.notes,
            dueDate: args.dueDate,
            priority: args.priority || undefined,
          },
        });

        const target = resolved.match ?? "the default list";
        return {
          content: [
            {
              type: "text" as const,
              text: `Reminder "${args.name}" queued for ${target} via agent "${agentName}" (${commandId}). It will appear in the synced data shortly.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error creating reminder: ${msg}`}]};
      }
    }
  );

  const findReminderByTitle = async (name: string, listName?: string) => {
    const filter: Record<string, unknown> = {
      title: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      syncStatus: "active",
      completed: false,
    };
    if (listName) {
      filter.listName = new RegExp(`^${listName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    return Reminder.find(filter).limit(2);
  };

  const completeReminderTool = tool(
    "complete_reminder",
    "Mark a synced Apple Reminder as completed (executed on the Mac by the edge agent).",
    {
      name: z.string().describe("The exact title of the reminder to complete"),
      listName: z.string().optional().describe("The list containing the reminder"),
    },
    async (args) => {
      try {
        const matches = await findReminderByTitle(args.name, args.listName);
        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No open reminder titled "${args.name}" found${args.listName ? ` in list "${args.listName}"` : ""}. Use list_reminders to see what exists.`,
              },
            ],
          };
        }
        if (matches.length > 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Multiple reminders titled "${args.name}" exist. Specify listName to disambiguate.`,
              },
            ],
          };
        }

        const reminder = matches[0];
        const {agentName, commandId} = await queueEdgeCommand({
          capability: "manage_reminders",
          type: "complete_reminder",
          payload: {externalId: reminder.externalId},
        });

        reminder.completed = true;
        reminder.completedAt = new Date();
        await reminder.save();

        return {
          content: [
            {
              type: "text" as const,
              text: `Completion of "${reminder.title}" queued via agent "${agentName}" (${commandId}).`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error completing reminder: ${msg}`}]};
      }
    }
  );

  const deleteReminderTool = tool(
    "delete_reminder",
    "Permanently delete a synced Apple Reminder (executed on the Mac by the edge agent).",
    {
      name: z.string().describe("The exact title of the reminder to delete"),
      listName: z.string().optional().describe("The list containing the reminder"),
    },
    async (args) => {
      try {
        const matches = await findReminderByTitle(args.name, args.listName);
        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No open reminder titled "${args.name}" found${args.listName ? ` in list "${args.listName}"` : ""}.`,
              },
            ],
          };
        }
        if (matches.length > 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Multiple reminders titled "${args.name}" exist. Specify listName to disambiguate.`,
              },
            ],
          };
        }

        const reminder = matches[0];
        const {agentName, commandId} = await queueEdgeCommand({
          capability: "manage_reminders",
          type: "delete_reminder",
          payload: {externalId: reminder.externalId},
        });

        reminder.syncStatus = "removed";
        await reminder.save();

        return {
          content: [
            {
              type: "text" as const,
              text: `Deletion of "${reminder.title}" queued via agent "${agentName}" (${commandId}).`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error deleting reminder: ${msg}`}]};
      }
    }
  );

  const describeReminderListTool = tool(
    "describe_reminder_list",
    "Save a description of what an Apple Reminders list is for (e.g. 'Groceries — shared shopping " +
      "list for weekly food runs'). Descriptions guide future list guessing when creating reminders. " +
      "Optionally mark the list as the default target.",
    {
      listName: z.string().describe("The list to describe (must match a synced list)"),
      description: z.string().describe("What this list is for"),
      isDefault: z
        .boolean()
        .optional()
        .describe("Set true to make this the default list for new reminders"),
    },
    async (args) => {
      const lists = await ReminderList.find({}).lean();
      const resolved = resolveTargetName(args.listName, lists);
      if (resolved.error || !resolved.match) {
        return {
          content: [
            {type: "text" as const, text: resolved.error ?? `List "${args.listName}" not found.`},
          ],
        };
      }
      if (args.isDefault) {
        await ReminderList.updateMany({isDefault: true}, {$set: {isDefault: false}});
      }
      await ReminderList.updateOne(
        {name: resolved.match},
        {$set: {description: args.description, ...(args.isDefault ? {isDefault: true} : {})}}
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved description for list "${resolved.match}"${args.isDefault ? " and marked it default" : ""}.`,
          },
        ],
      };
    }
  );

  const listCalendarsTool = tool(
    "list_calendars",
    "List all Apple Calendar calendars (synced from the Mac by the edge agent), including each " +
      "calendar's purpose description. Check this before creating an event when unsure which " +
      "calendar fits — the descriptions explain what each calendar is for.",
    {},
    async () => {
      const calendars = await AppleCalendar.find({}).sort({name: 1}).lean();
      if (calendars.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No calendars synced yet. Is the iMessage edge agent running and approved?",
            },
          ],
        };
      }
      const result = calendars.map((c) => ({
        name: c.name,
        description: c.description ?? null,
        isDefault: c.isDefault,
        writable: c.writable,
        lastSyncedAt: formatDate(c.lastSyncedAt),
      }));
      return {content: [{type: "text" as const, text: JSON.stringify(result, null, 2)}]};
    }
  );

  const listCalendarEventsTool = tool(
    "list_calendar_events",
    "List calendar events synced from Apple Calendar. Defaults to the next 14 days.",
    {
      start: z.string().optional().describe("Range start, ISO 8601 (default: now)"),
      end: z.string().optional().describe("Range end, ISO 8601 (default: start + 14 days)"),
      calendarName: z.string().optional().describe("Filter by calendar name"),
    },
    async (args) => {
      const start = args.start ? DateTime.fromISO(args.start) : DateTime.now();
      const end = args.end ? DateTime.fromISO(args.end) : start.plus({days: 14});
      if (!start.isValid || !end.isValid) {
        return {
          content: [{type: "text" as const, text: "Invalid start/end date. Use ISO 8601."}],
        };
      }

      const filter: Record<string, unknown> = {
        syncStatus: "active",
        startDate: {$gte: start.toJSDate(), $lt: end.toJSDate()},
      };
      if (args.calendarName) {
        filter.calendarName = new RegExp(
          `^${args.calendarName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        );
      }
      const events = await CalendarEvent.find(filter).sort({startDate: 1}).limit(200).lean();
      if (events.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No events between ${start.toISODate()} and ${end.toISODate()}.`,
            },
          ],
        };
      }
      const result = events.map((e) => ({
        title: e.title,
        calendar: e.calendarName,
        start: formatDate(e.startDate),
        end: formatDate(e.endDate),
        allDay: e.allDay,
        location: e.location ?? null,
        notes: e.notes ?? null,
        status: e.status ?? null,
      }));
      return {content: [{type: "text" as const, text: JSON.stringify(result, null, 2)}]};
    }
  );

  const createCalendarEventTool = tool(
    "create_calendar_event",
    "Create an event in Apple Calendar (executed on the Mac by the edge agent). " +
      "If the user didn't name a calendar, guess the right one: call list_calendars and match the " +
      "event to a calendar using the calendar descriptions (e.g. a dentist appointment goes to a " +
      "personal/health calendar). Omit calendarName only when nothing fits — that uses the default calendar.",
    {
      title: z.string().describe("The event title"),
      calendarName: z
        .string()
        .optional()
        .describe("Target calendar name. Omit to use the default calendar."),
      startDate: z
        .string()
        .describe(
          "Start as ISO 8601 (e.g. '2026-07-12T09:00:00'). Timezone-less values use the Mac's local timezone."
        ),
      endDate: z
        .string()
        .optional()
        .describe("End as ISO 8601. Defaults to one hour after startDate."),
      allDay: z.boolean().default(false).describe("All-day event"),
      location: z.string().optional().describe("Event location"),
      notes: z.string().optional().describe("Event notes"),
    },
    async (args) => {
      try {
        const start = DateTime.fromISO(args.startDate);
        if (!start.isValid) {
          return {
            content: [{type: "text" as const, text: "Invalid startDate. Use ISO 8601."}],
          };
        }
        let endDate = args.endDate;
        if (!endDate) {
          const computed = args.allDay
            ? start.endOf("day").toISO()
            : start.plus({hours: 1}).toISO();
          endDate = computed ?? args.startDate;
        }

        const calendars = await AppleCalendar.find({writable: true}).lean();
        const resolved = resolveTargetName(args.calendarName, calendars);
        if (resolved.error) {
          return {content: [{type: "text" as const, text: resolved.error}]};
        }

        const {agentName, commandId} = await queueEdgeCommand({
          capability: "manage_calendar",
          type: "create_calendar_event",
          payload: {
            title: args.title,
            calendarName: resolved.match,
            startDate: args.startDate,
            endDate,
            allDay: args.allDay || undefined,
            location: args.location,
            notes: args.notes,
          },
        });

        const target = resolved.match ?? "the default calendar";
        return {
          content: [
            {
              type: "text" as const,
              text: `Event "${args.title}" queued for ${target} via agent "${agentName}" (${commandId}). It will appear in the synced data shortly.`,
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return {content: [{type: "text" as const, text: `Error creating event: ${msg}`}]};
      }
    }
  );

  const describeCalendarTool = tool(
    "describe_calendar",
    "Save a description of what an Apple Calendar is for (e.g. 'Family — kids' school events and " +
      "activities'). Descriptions guide future calendar guessing when creating events. Optionally " +
      "mark the calendar as the default target.",
    {
      calendarName: z.string().describe("The calendar to describe (must match a synced calendar)"),
      description: z.string().describe("What this calendar is for"),
      isDefault: z
        .boolean()
        .optional()
        .describe("Set true to make this the default calendar for new events"),
    },
    async (args) => {
      const calendars = await AppleCalendar.find({}).lean();
      const resolved = resolveTargetName(args.calendarName, calendars);
      if (resolved.error || !resolved.match) {
        return {
          content: [
            {
              type: "text" as const,
              text: resolved.error ?? `Calendar "${args.calendarName}" not found.`,
            },
          ],
        };
      }
      if (args.isDefault) {
        await AppleCalendar.updateMany({isDefault: true}, {$set: {isDefault: false}});
      }
      await AppleCalendar.updateOne(
        {name: resolved.match},
        {$set: {description: args.description, ...(args.isDefault ? {isDefault: true} : {})}}
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved description for calendar "${resolved.match}"${args.isDefault ? " and marked it default" : ""}.`,
          },
        ],
      };
    }
  );

  return [
    listReminderListsTool,
    listRemindersTool,
    createReminderTool,
    completeReminderTool,
    deleteReminderTool,
    describeReminderListTool,
    listCalendarsTool,
    listCalendarEventsTool,
    createCalendarEventTool,
    describeCalendarTool,
  ];
};
