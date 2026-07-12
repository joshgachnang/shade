import type {ReminderListPayload, ReminderPayload} from "@shade/edge-agent-types";
import {runJxa} from "./jxa";

export interface RemindersSnapshot {
  lists: ReminderListPayload[];
  reminders: ReminderPayload[];
}

export interface CreateReminderInput {
  title: string;
  listName?: string;
  notes?: string;
  dueDate?: string; // ISO 8601
  priority?: number;
}

export interface CreatedReminder {
  externalId: string;
  listName: string;
}

/**
 * All Apple access goes through Reminders.app/Calendar.app scripting (Apple
 * events) rather than EventKit: EventKit permission prompts can never be shown
 * for a bare launchd binary (no usage-description strings), while automation
 * consent prompts work — the same mechanism the agent already uses to send
 * iMessages. Properties are bulk-fetched per list to keep Apple event counts low.
 */

/** Fetch every reminder list plus all incomplete (not completed, not deleted) reminders. */
export const fetchRemindersSnapshot = async (): Promise<RemindersSnapshot> => {
  const script = `
const app = Application("Reminders");
const allLists = app.lists();
const lists = [];
const reminders = [];

for (let i = 0; i < allLists.length; i++) {
  const list = allLists[i];
  const listName = list.name();
  const listId = list.id();
  lists.push({externalId: listId, name: listName});

  const pending = list.reminders.whose({completed: false});
  const ids = pending.id();
  const names = pending.name();
  const bodies = pending.body();
  const dueDates = pending.dueDate();
  const priorities = pending.priority();

  for (let j = 0; j < ids.length; j++) {
    reminders.push({
      externalId: ids[j],
      title: names[j] || "",
      notes: bodies[j] || null,
      dueDate: dueDates[j] ? dueDates[j].toISOString() : null,
      priority: priorities[j] || 0,
      completed: false,
      listName,
      listExternalId: listId,
    });
  }
}

JSON.stringify({lists, reminders});
`;

  const output = await runJxa(script);
  return JSON.parse(output) as RemindersSnapshot;
};

/**
 * Create a reminder. If listName is omitted or doesn't match any list
 * (case-insensitive), the default Reminders list is used.
 */
export const createReminder = async (input: CreateReminderInput): Promise<CreatedReminder> => {
  const script = `
const app = Application("Reminders");
const args = ${JSON.stringify(input)};

let target = null;
if (args.listName) {
  const allLists = app.lists();
  for (let i = 0; i < allLists.length; i++) {
    if (allLists[i].name().toLowerCase() === args.listName.toLowerCase()) {
      target = allLists[i];
      break;
    }
  }
}
if (!target) {
  try {
    target = app.defaultList();
  } catch (_err) {
    target = null;
  }
}
if (!target) {
  const allLists = app.lists();
  if (allLists.length === 0) {
    throw new Error("No reminder lists exist");
  }
  target = allLists[0];
}

const props = {name: args.title};
if (args.notes) {
  props.body = args.notes;
}
if (args.priority) {
  props.priority = args.priority;
}
if (args.dueDate) {
  const due = new Date(args.dueDate);
  if (Number.isNaN(due.getTime())) {
    throw new Error("Invalid dueDate: " + args.dueDate);
  }
  props.dueDate = due;
}

const reminder = app.Reminder(props);
target.reminders.push(reminder);

JSON.stringify({externalId: reminder.id(), listName: target.name()});
`;

  const output = await runJxa(script);
  return JSON.parse(output) as CreatedReminder;
};

/** Mark a reminder completed by its Reminders.app id. */
export const completeReminder = async (externalId: string): Promise<void> => {
  await mutateReminder(externalId, "complete");
};

/** Permanently delete a reminder by its Reminders.app id. */
export const deleteReminder = async (externalId: string): Promise<void> => {
  await mutateReminder(externalId, "delete");
};

const mutateReminder = async (externalId: string, action: "complete" | "delete"): Promise<void> => {
  const script = `
const app = Application("Reminders");
const args = ${JSON.stringify({externalId, action})};

let found = null;
const allLists = app.lists();
for (let i = 0; i < allLists.length && !found; i++) {
  const matches = allLists[i].reminders.whose({id: args.externalId});
  if (matches.length > 0) {
    found = matches[0];
  }
}
if (!found) {
  throw new Error("Reminder not found: " + args.externalId);
}

if (args.action === "complete") {
  found.completed = true;
} else {
  app.delete(found);
}

JSON.stringify({ok: true});
`;

  await runJxa(script);
};
