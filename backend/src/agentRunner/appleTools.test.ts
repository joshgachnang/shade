import {beforeEach, describe, expect, test} from "bun:test";
import {AppleCalendar} from "../models/appleCalendarModel";
import {CalendarEvent} from "../models/calendarEvent";
import {EdgeAgent} from "../models/edgeAgent";
import {Reminder} from "../models/reminder";
import {ReminderList} from "../models/reminderList";
import {buildAppleTools, resolveTargetName} from "./appleTools";

const callTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const tools = buildAppleTools();
  const toolDef = tools.find((t) => t.name === name);
  if (!toolDef) {
    throw new Error(`Tool ${name} not registered`);
  }
  const handler = toolDef.handler as (
    a: unknown,
    e: unknown
  ) => Promise<{content: {text: string}[]}>;
  const result = await handler(args, {});
  return result.content[0].text;
};

const makeAgent = async (capabilities: string[]) => {
  return EdgeAgent.create({
    name: `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentType: "imessage",
    status: "online",
    capabilities,
    authTokenHash: "hash",
    lastHeartbeatAt: new Date(),
  });
};

beforeEach(async () => {
  await Promise.all([
    EdgeAgent.deleteMany({}),
    ReminderList.deleteMany({}),
    Reminder.deleteMany({}),
    AppleCalendar.deleteMany({}),
    CalendarEvent.deleteMany({}),
  ]);
});

describe("resolveTargetName", () => {
  const candidates = [
    {name: "Groceries", description: "Weekly shopping", isDefault: false},
    {name: "Home Projects", description: undefined, isDefault: true},
  ];

  test("exact match is case-insensitive", () => {
    expect(resolveTargetName("groceries", candidates).match).toBe("Groceries");
  });

  test("unique substring matches", () => {
    expect(resolveTargetName("projects", candidates).match).toBe("Home Projects");
  });

  test("no requested name falls back to the default candidate", () => {
    expect(resolveTargetName(undefined, candidates).match).toBe("Home Projects");
  });

  test("no requested name and no default returns undefined match", () => {
    const result = resolveTargetName(undefined, [
      {name: "A", isDefault: false},
      {name: "B", isDefault: false},
    ]);
    expect(result.match).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("unmatched name returns an error listing candidates", () => {
    const result = resolveTargetName("Work", candidates);
    expect(result.match).toBeUndefined();
    expect(result.error).toContain("Groceries");
    expect(result.error).toContain("Weekly shopping");
  });
});

describe("create_reminder tool", () => {
  test("queues a create_reminder command on the reminders-capable agent", async () => {
    const agent = await makeAgent(["manage_reminders"]);
    await ReminderList.create({externalId: "l1", name: "Groceries", isDefault: false});

    const text = await callTool("create_reminder", {
      name: "Buy milk",
      listName: "groceries",
      priority: 0,
    });

    expect(text).toContain("queued");
    const updated = await EdgeAgent.findExactlyOne({_id: agent._id});
    expect(updated.pendingCommands.length).toBe(1);
    expect(updated.pendingCommands[0].type).toBe("create_reminder");
    expect(updated.pendingCommands[0].payload).toMatchObject({
      title: "Buy milk",
      listName: "Groceries",
    });
  });

  test("errors helpfully when no capable agent exists", async () => {
    const text = await callTool("create_reminder", {name: "Buy milk", priority: 0});
    expect(text).toContain("No approved edge agent");
  });

  test("rejects an unknown list with available options", async () => {
    await makeAgent(["manage_reminders"]);
    await ReminderList.create({
      externalId: "l1",
      name: "Groceries",
      description: "Food shopping",
      isDefault: false,
    });

    const text = await callTool("create_reminder", {
      name: "Buy milk",
      listName: "Nonexistent",
      priority: 0,
    });

    expect(text).toContain('No match for "Nonexistent"');
    expect(text).toContain("Groceries");
  });
});

describe("complete_reminder tool", () => {
  test("queues completion by externalId and optimistically marks the local copy", async () => {
    const agent = await makeAgent(["manage_reminders"]);
    await Reminder.create({
      externalId: "rem-1",
      title: "Buy milk",
      listName: "Groceries",
      listExternalId: "l1",
      priority: 0,
      completed: false,
      syncStatus: "active",
    });

    const text = await callTool("complete_reminder", {name: "buy milk"});

    expect(text).toContain("queued");
    const updatedAgent = await EdgeAgent.findExactlyOne({_id: agent._id});
    expect(updatedAgent.pendingCommands[0].type).toBe("complete_reminder");
    expect(updatedAgent.pendingCommands[0].payload).toMatchObject({externalId: "rem-1"});
    const reminder = await Reminder.findExactlyOne({externalId: "rem-1"});
    expect(reminder.completed).toBe(true);
  });

  test("reports when no matching reminder exists", async () => {
    const text = await callTool("complete_reminder", {name: "Missing"});
    expect(text).toContain("No open reminder");
  });
});

describe("create_calendar_event tool", () => {
  test("queues a create_calendar_event command with a guessed calendar", async () => {
    const agent = await makeAgent(["manage_calendar"]);
    await AppleCalendar.create({
      externalId: "c1",
      name: "Family",
      writable: true,
      isDefault: true,
    });

    const text = await callTool("create_calendar_event", {
      title: "Soccer practice",
      startDate: "2026-07-14T17:00:00",
      allDay: false,
    });

    expect(text).toContain("queued");
    const updated = await EdgeAgent.findExactlyOne({_id: agent._id});
    expect(updated.pendingCommands[0].type).toBe("create_calendar_event");
    expect(updated.pendingCommands[0].payload).toMatchObject({
      title: "Soccer practice",
      calendarName: "Family",
    });
    // endDate defaults to one hour after start
    expect(updated.pendingCommands[0].payload.endDate).toContain("18:00");
  });
});

describe("describe tools", () => {
  test("describe_reminder_list saves description and swaps the default flag", async () => {
    await ReminderList.create({externalId: "l1", name: "Groceries", isDefault: true});
    await ReminderList.create({externalId: "l2", name: "Home", isDefault: false});

    const text = await callTool("describe_reminder_list", {
      listName: "Home",
      description: "House chores and repairs",
      isDefault: true,
    });

    expect(text).toContain("Home");
    const home = await ReminderList.findExactlyOne({externalId: "l2"});
    expect(home.description).toBe("House chores and repairs");
    expect(home.isDefault).toBe(true);
    const groceries = await ReminderList.findExactlyOne({externalId: "l1"});
    expect(groceries.isDefault).toBe(false);
  });

  test("describe_calendar saves description", async () => {
    await AppleCalendar.create({externalId: "c1", name: "Family", writable: true});

    await callTool("describe_calendar", {
      calendarName: "family",
      description: "Kids' school events and activities",
    });

    const calendar = await AppleCalendar.findExactlyOne({externalId: "c1"});
    expect(calendar.description).toBe("Kids' school events and activities");
  });
});

describe("list tools", () => {
  test("list_reminder_lists includes descriptions and open counts", async () => {
    await ReminderList.create({
      externalId: "l1",
      name: "Groceries",
      description: "Food shopping",
      isDefault: false,
    });
    await Reminder.create({
      externalId: "rem-1",
      title: "Buy milk",
      listName: "Groceries",
      listExternalId: "l1",
      priority: 0,
      completed: false,
      syncStatus: "active",
    });

    const text = await callTool("list_reminder_lists", {});
    const parsed = JSON.parse(text);
    expect(parsed[0].name).toBe("Groceries");
    expect(parsed[0].description).toBe("Food shopping");
    expect(parsed[0].openReminders).toBe(1);
  });

  test("list_calendar_events filters by range and hides removed events", async () => {
    await CalendarEvent.create({
      externalId: "evt-1",
      title: "In range",
      startDate: new Date("2026-07-14T10:00:00.000Z"),
      endDate: new Date("2026-07-14T11:00:00.000Z"),
      allDay: false,
      calendarName: "Personal",
      calendarExternalId: "c1",
      syncStatus: "active",
    });
    await CalendarEvent.create({
      externalId: "evt-2",
      title: "Removed",
      startDate: new Date("2026-07-14T12:00:00.000Z"),
      endDate: new Date("2026-07-14T13:00:00.000Z"),
      allDay: false,
      calendarName: "Personal",
      calendarExternalId: "c1",
      syncStatus: "removed",
    });

    const text = await callTool("list_calendar_events", {
      start: "2026-07-13T00:00:00.000Z",
      end: "2026-07-16T00:00:00.000Z",
    });
    const parsed = JSON.parse(text);
    expect(parsed.length).toBe(1);
    expect(parsed[0].title).toBe("In range");
  });
});
