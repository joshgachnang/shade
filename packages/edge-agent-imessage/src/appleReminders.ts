import type {ReminderListPayload, ReminderPayload} from "@shade/edge-agent-types";
import {EVENTKIT_PREAMBLE, runJxa} from "./jxa";

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

/** Fetch every reminder list plus all incomplete (not completed, not deleted) reminders. */
export const fetchRemindersSnapshot = async (): Promise<RemindersSnapshot> => {
  const script = `
${EVENTKIT_PREAMBLE}
requestAccess($.EKEntityTypeReminder);

const calendars = store.calendarsForEntityType($.EKEntityTypeReminder);
const lists = [];
for (let i = 0; i < calendars.count; i++) {
  const c = calendars.objectAtIndex(i);
  lists.push({
    externalId: ObjC.unwrap(c.calendarIdentifier),
    name: ObjC.unwrap(c.title),
  });
}

const predicate = store.predicateForIncompleteRemindersWithDueDateStartingEndingCalendars(
  $(), $(), $()
);
let fetched = null;
let done = false;
store.fetchRemindersMatchingPredicateCompletion(predicate, (rems) => {
  fetched = rems;
  done = true;
});
if (!spinUntil(() => done, 60)) {
  throw new Error("Timed out fetching reminders");
}

const reminders = [];
const count = fetched.count;
for (let i = 0; i < count; i++) {
  const r = fetched.objectAtIndex(i);
  let dueIso = null;
  if (!r.dueDateComponents.isNil()) {
    const due = $.NSCalendar.currentCalendar.dateFromComponents(r.dueDateComponents);
    if (!due.isNil()) {
      dueIso = ObjC.unwrap(due).toISOString();
    }
  }
  reminders.push({
    externalId: ObjC.unwrap(r.calendarItemIdentifier),
    title: ObjC.unwrap(r.title) || "",
    notes: r.notes.isNil() ? null : ObjC.unwrap(r.notes),
    dueDate: dueIso,
    priority: Number(r.priority) || 0,
    completed: false,
    listName: ObjC.unwrap(r.calendar.title),
    listExternalId: ObjC.unwrap(r.calendar.calendarIdentifier),
  });
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
${EVENTKIT_PREAMBLE}
requestAccess($.EKEntityTypeReminder);

const args = ${JSON.stringify(input)};

let target = null;
if (args.listName) {
  const calendars = store.calendarsForEntityType($.EKEntityTypeReminder);
  for (let i = 0; i < calendars.count; i++) {
    const c = calendars.objectAtIndex(i);
    if (ObjC.unwrap(c.title).toLowerCase() === args.listName.toLowerCase()) {
      target = c;
      break;
    }
  }
}
if (!target) {
  target = store.defaultCalendarForNewReminders;
  if (!target || target.isNil()) {
    throw new Error("No target reminder list found and no default list configured");
  }
}

const reminder = $.EKReminder.reminderWithEventStore(store);
reminder.title = args.title;
reminder.calendar = target;
if (args.notes) {
  reminder.notes = args.notes;
}
if (args.priority) {
  reminder.priority = args.priority;
}
if (args.dueDate) {
  const ms = new Date(args.dueDate).getTime();
  if (Number.isNaN(ms)) {
    throw new Error("Invalid dueDate: " + args.dueDate);
  }
  const nsDate = $.NSDate.dateWithTimeIntervalSince1970(ms / 1000);
  const units =
    $.NSCalendarUnitYear |
    $.NSCalendarUnitMonth |
    $.NSCalendarUnitDay |
    $.NSCalendarUnitHour |
    $.NSCalendarUnitMinute;
  reminder.dueDateComponents = $.NSCalendar.currentCalendar.componentsFromDate(units, nsDate);
}

const err = Ref();
if (!store.saveReminderCommitError(reminder, true, err)) {
  throw new Error("Failed to save reminder: " + ObjC.unwrap(err[0].localizedDescription));
}

JSON.stringify({
  externalId: ObjC.unwrap(reminder.calendarItemIdentifier),
  listName: ObjC.unwrap(target.title),
});
`;

  const output = await runJxa(script);
  return JSON.parse(output) as CreatedReminder;
};

/** Mark a reminder completed by its EventKit calendarItemIdentifier. */
export const completeReminder = async (externalId: string): Promise<void> => {
  await mutateReminder(externalId, "complete");
};

/** Permanently delete a reminder by its EventKit calendarItemIdentifier. */
export const deleteReminder = async (externalId: string): Promise<void> => {
  await mutateReminder(externalId, "delete");
};

const mutateReminder = async (externalId: string, action: "complete" | "delete"): Promise<void> => {
  const script = `
${EVENTKIT_PREAMBLE}
requestAccess($.EKEntityTypeReminder);

const args = ${JSON.stringify({externalId, action})};

const item = store.calendarItemWithIdentifier(args.externalId);
if (item.isNil()) {
  throw new Error("Reminder not found: " + args.externalId);
}

const err = Ref();
if (args.action === "complete") {
  item.completed = true;
  if (!store.saveReminderCommitError(item, true, err)) {
    throw new Error("Failed to complete reminder: " + ObjC.unwrap(err[0].localizedDescription));
  }
} else {
  if (!store.removeReminderCommitError(item, true, err)) {
    throw new Error("Failed to delete reminder: " + ObjC.unwrap(err[0].localizedDescription));
  }
}

JSON.stringify({ok: true});
`;

  await runJxa(script);
};
