import {DateTime} from "luxon";
import type {AppleCalendarEvent, AppleCalendarInfo, CreateEventInput} from "../utils/appleCalendar";
import type {AppleContact, CreateContactInput, UpdateContactInput} from "../utils/appleContacts";

/**
 * Fixture data behind the Apple Calendar/Contacts integrations in test mode
 * (IP-012). The real implementations shell out to macOS JXA/AppleScript —
 * these keep the same function contracts working offline and on Linux CI.
 * The contact store is in-memory and process-local: creates/updates mutate it
 * so multi-step agent flows behave realistically within a session.
 */

const makeContact = (overrides: Partial<AppleContact>): AppleContact => ({
  id: "",
  firstName: "",
  lastName: "",
  fullName: "",
  nickname: "",
  company: "",
  jobTitle: "",
  department: "",
  emails: [],
  phones: [],
  addresses: [],
  birthday: null,
  note: "",
  groups: [],
  ...overrides,
});

const seedContacts = (): AppleContact[] => [
  makeContact({
    id: "test-contact-1",
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    company: "Analytical Engines Ltd",
    jobTitle: "Engineer",
    emails: [{label: "work", value: "ada@example.com"}],
    phones: [{label: "mobile", value: "+15550100001"}],
    groups: ["Test Group"],
  }),
  makeContact({
    id: "test-contact-2",
    firstName: "Grace",
    lastName: "Hopper",
    fullName: "Grace Hopper",
    company: "US Navy",
    jobTitle: "Rear Admiral",
    emails: [{label: "work", value: "grace@example.com"}],
    phones: [{label: "mobile", value: "+15550100002"}],
    groups: ["Test Group"],
  }),
];

let testContacts = seedContacts();
let contactCounter = testContacts.length;

export const resetTestContacts = (): void => {
  testContacts = seedContacts();
  contactCounter = testContacts.length;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const getTestContacts = (): AppleContact[] => clone(testContacts);

export const searchTestContacts = (query: string): AppleContact[] => {
  const q = query.toLowerCase();
  return clone(
    testContacts.filter((contact) =>
      [
        contact.fullName,
        contact.firstName,
        contact.lastName,
        contact.nickname,
        contact.company,
        contact.note,
        ...contact.emails.map((e) => e.value),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
  );
};

export const getTestContactById = (id: string): AppleContact | null => {
  const contact = testContacts.find((c) => c.id === id);
  return contact ? clone(contact) : null;
};

export const createTestContact = (input: CreateContactInput): AppleContact => {
  const contact = makeContact({
    id: `test-contact-${++contactCounter}`,
    firstName: input.firstName,
    lastName: input.lastName ?? "",
    fullName: [input.firstName, input.lastName].filter(Boolean).join(" "),
    company: input.company ?? "",
    jobTitle: input.jobTitle ?? "",
    emails: input.emails ?? [],
    phones: input.phones ?? [],
    note: input.note ?? "",
    birthday: input.birthday ?? null,
  });
  testContacts.push(contact);
  return clone(contact);
};

export const updateTestContact = (input: UpdateContactInput): AppleContact => {
  const contact = testContacts.find((c) => c.id === input.id);
  if (!contact) {
    throw new Error(`Contact not found: ${input.id}`);
  }
  if (input.firstName !== undefined) contact.firstName = input.firstName;
  if (input.lastName !== undefined) contact.lastName = input.lastName;
  if (input.company !== undefined) contact.company = input.company;
  if (input.jobTitle !== undefined) contact.jobTitle = input.jobTitle;
  if (input.note !== undefined) contact.note = input.note;
  contact.fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return clone(contact);
};

export const matchTestContactByEmail = (email: string): AppleContact | null => {
  const target = email.toLowerCase();
  const contact = testContacts.find((c) => c.emails.some((e) => e.value.toLowerCase() === target));
  return contact ? clone(contact) : null;
};

export const matchTestContactByPhone = (phone: string): AppleContact | null => {
  const targetTail = phone.replace(/[^0-9+]/g, "").slice(-10);
  const contact = testContacts.find((c) =>
    c.phones.some((p) => p.value.replace(/[^0-9+]/g, "").slice(-10) === targetTail)
  );
  return contact ? clone(contact) : null;
};

export const getTestContactGroups = (): {name: string; id: string; count: number}[] => [
  {name: "Test Group", id: "test-group-1", count: testContacts.length},
];

// --- Calendar ---

export const getTestCalendars = (): AppleCalendarInfo[] => [
  {name: "Home", id: "test-cal-home"},
  {name: "Work", id: "test-cal-work"},
];

let eventCounter = 0;

/**
 * Two deterministic events placed inside the requested window (1h and 3h after
 * its start) so any queried range comes back non-empty.
 */
export const getTestCalendarEvents = ({
  calendarNames,
  startDate,
}: {
  calendarNames: string[];
  startDate: string;
}): AppleCalendarEvent[] => {
  const start = DateTime.fromISO(startDate);
  const calendarName = calendarNames[0] ?? "Home";
  return [
    {
      id: "test-event-standup",
      summary: "Team standup",
      startDate: start.plus({hours: 1}).toISO() ?? "",
      endDate: start.plus({hours: 1, minutes: 30}).toISO() ?? "",
      location: "Video call",
      notes: "Fixture event from the AI testability harness",
      calendarName,
      isAllDay: false,
      url: "",
    },
    {
      id: "test-event-review",
      summary: "Plan review",
      startDate: start.plus({hours: 3}).toISO() ?? "",
      endDate: start.plus({hours: 4}).toISO() ?? "",
      location: "",
      notes: "",
      calendarName,
      isAllDay: false,
      url: "",
    },
  ];
};

export const createTestCalendarEvent = (input: CreateEventInput): AppleCalendarEvent => ({
  id: `test-event-${++eventCounter}`,
  summary: input.summary,
  startDate: input.startDate,
  endDate: input.endDate,
  location: input.location ?? "",
  notes: input.notes ?? "",
  calendarName: input.calendarName,
  isAllDay: input.isAllDay ?? false,
  url: "",
});
