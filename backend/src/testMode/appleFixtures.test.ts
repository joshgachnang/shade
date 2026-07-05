import {afterAll, beforeAll, beforeEach, describe, expect, test} from "bun:test";
import {createEvent, getEvents, listCalendars} from "../utils/appleCalendar";
import {
  createContact,
  getContactById,
  listAllContacts,
  listGroups,
  matchContactByEmail,
  matchContactByPhone,
  searchContacts,
  updateContact,
} from "../utils/appleContacts";
import {resetTestContacts} from "./fixtures";

/**
 * In test mode the Apple Calendar/Contacts integrations return fixture data
 * instead of shelling out to macOS JXA/AppleScript — this is what keeps the
 * harness offline and deterministic on any platform. These tests exercise the
 * guards through the real util entry points.
 */

const ORIGINAL_TEST_MODE = process.env.SHADE_TEST_MODE;

describe("Apple integrations in test mode", () => {
  beforeAll(() => {
    process.env.SHADE_TEST_MODE = "1";
  });

  beforeEach(() => {
    resetTestContacts();
  });

  afterAll(() => {
    if (ORIGINAL_TEST_MODE === undefined) {
      delete process.env.SHADE_TEST_MODE;
    } else {
      process.env.SHADE_TEST_MODE = ORIGINAL_TEST_MODE;
    }
  });

  test("listCalendars returns the fixture calendars", async () => {
    const calendars = await listCalendars();
    expect(calendars.map((c) => c.name)).toEqual(["Home", "Work"]);
  });

  test("getEvents places deterministic events inside the requested window", async () => {
    const events = await getEvents({
      calendarNames: ["Work"],
      startDate: "2026-07-04T08:00:00Z",
      endDate: "2026-07-04T20:00:00Z",
    });

    expect(events).toHaveLength(2);
    expect(events[0].calendarName).toBe("Work");
    for (const event of events) {
      expect(new Date(event.startDate).getTime()).toBeGreaterThan(
        new Date("2026-07-04T08:00:00Z").getTime()
      );
      expect(new Date(event.endDate).getTime()).toBeLessThan(
        new Date("2026-07-04T20:00:00Z").getTime()
      );
    }
  });

  test("getEvents still validates dates before returning fixtures", async () => {
    expect(
      getEvents({calendarNames: ["Work"], startDate: "not-a-date", endDate: "also-not"})
    ).rejects.toThrow(/ISO 8601/);
  });

  test("createEvent echoes the input as a created fixture event", async () => {
    const event = await createEvent({
      summary: "Dentist",
      startDate: "2026-07-05T15:00:00Z",
      endDate: "2026-07-05T16:00:00Z",
      calendarName: "Home",
    });
    expect(event.id).toMatch(/^test-event-/);
    expect(event.summary).toBe("Dentist");
  });

  test("contact search matches name, company, and email", async () => {
    expect((await searchContacts("lovelace")).map((c) => c.fullName)).toEqual(["Ada Lovelace"]);
    expect((await searchContacts("navy")).map((c) => c.fullName)).toEqual(["Grace Hopper"]);
    expect(await searchContacts("ada@example.com")).toHaveLength(1);
    expect(await searchContacts("nobody-matches-this")).toHaveLength(0);
  });

  test("create → get → update round-trips through the in-memory store", async () => {
    const created = await createContact({
      firstName: "Alan",
      lastName: "Turing",
      emails: [{label: "work", value: "alan@example.com"}],
    });
    expect(created.id).toMatch(/^test-contact-/);

    const fetched = await getContactById(created.id);
    expect(fetched?.fullName).toBe("Alan Turing");

    const updated = await updateContact({id: created.id, company: "Bletchley Park"});
    expect(updated.company).toBe("Bletchley Park");
    expect((await getContactById(created.id))?.company).toBe("Bletchley Park");
  });

  test("email and phone matching find the seeded contacts", async () => {
    expect((await matchContactByEmail("GRACE@example.com"))?.fullName).toBe("Grace Hopper");
    // Last-10-digit matching handles country-code differences.
    expect((await matchContactByPhone("555-010-0001"))?.fullName).toBe("Ada Lovelace");
    expect(await matchContactByEmail("unknown@example.com")).toBeNull();
  });

  test("listAllContacts and listGroups reflect the store", async () => {
    expect(await listAllContacts()).toHaveLength(2);
    const [group] = await listGroups();
    expect(group.name).toBe("Test Group");
    expect(group.count).toBe(2);
  });

  test("resetTestContacts discards mutations", async () => {
    await createContact({firstName: "Temp"});
    expect(await listAllContacts()).toHaveLength(3);
    resetTestContacts();
    expect(await listAllContacts()).toHaveLength(2);
  });
});
