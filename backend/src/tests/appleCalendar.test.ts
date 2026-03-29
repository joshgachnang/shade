import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {CalendarConfig} from "../models/calendarConfig";
import {resetExecAsync, setExecAsync} from "../utils/appleCalendar";
import type {TestData} from "./testHelper";
import {ADMIN_EMAIL, loginAsUser, setupTestServer, stopTestServer, USER_EMAIL} from "./testHelper";

let baseUrl: string;
let testData: TestData;
let adminToken: string;
let userToken: string;

const mockExec = (stdout: string) => {
  setExecAsync((() => Promise.resolve({stdout, stderr: ""})) as any);
};

beforeAll(async () => {
  const setup = await setupTestServer();
  baseUrl = setup.baseUrl;
  testData = setup.testData;

  adminToken = await loginAsUser(baseUrl, ADMIN_EMAIL);
  userToken = await loginAsUser(baseUrl, USER_EMAIL);
}, 30000);

afterEach(() => {
  resetExecAsync();
});

afterAll(async () => {
  await stopTestServer();
});

// ─── GET /apple-calendar/calendars ───────────────────────────────────────────

describe("GET /apple-calendar/calendars", () => {
  test("rejects unauthenticated requests", async () => {
    const res = await fetch(`${baseUrl}/apple-calendar/calendars`);
    expect(res.status).toBe(401);
  });

  test("returns calendars from Calendar.app", async () => {
    mockExec("Work|||uid-1\nPersonal|||uid-2\n");
    const res = await fetch(`${baseUrl}/apple-calendar/calendars`, {
      headers: {Authorization: `Bearer ${userToken}`},
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {data: Array<{name: string; id: string}>};
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe("Work");
    expect(body.data[1].name).toBe("Personal");
  });

  test("returns empty array when no calendars exist", async () => {
    mockExec("");
    const res = await fetch(`${baseUrl}/apple-calendar/calendars`, {
      headers: {Authorization: `Bearer ${userToken}`},
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {data: Array<{name: string; id: string}>};
    expect(body.data).toEqual([]);
  });
});

// ─── GET /apple-calendar/events ──────────────────────────────────────────────

describe("GET /apple-calendar/events", () => {
  test("rejects unauthenticated requests", async () => {
    const res = await fetch(
      `${baseUrl}/apple-calendar/events?start=2026-03-29T00:00:00&end=2026-03-29T23:59:59`
    );
    expect(res.status).toBe(401);
  });

  test("requires start and end params", async () => {
    const res = await fetch(`${baseUrl}/apple-calendar/events`, {
      headers: {Authorization: `Bearer ${userToken}`},
    });
    expect(res.status).toBe(400);
  });

  test("requires start param", async () => {
    const res = await fetch(`${baseUrl}/apple-calendar/events?end=2026-03-29T23:59:59`, {
      headers: {Authorization: `Bearer ${userToken}`},
    });
    expect(res.status).toBe(400);
  });

  test("returns events when calendars specified via query param", async () => {
    mockExec(
      "evt-1|||Standup|||March 29, 2026 9:00:00 AM|||March 29, 2026 9:30:00 AM||| ||| |||Work|||false||| "
    );
    const res = await fetch(
      `${baseUrl}/apple-calendar/events?start=2026-03-29T00:00:00&end=2026-03-29T23:59:59&calendars=Work`,
      {headers: {Authorization: `Bearer ${userToken}`}}
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {data: Array<{summary: string}>};
    expect(body.data).toHaveLength(1);
    expect(body.data[0].summary).toBe("Standup");
  });

  test("returns events using saved calendar config", async () => {
    // Create a calendar config for this user
    await CalendarConfig.create({
      name: "default",
      enabledCalendars: ["Work", "Personal"],
      owner: testData.user._id,
    });

    mockExec(
      "evt-1|||Meeting|||March 29, 2026 10:00:00 AM|||March 29, 2026 11:00:00 AM||| ||| |||Work|||false||| "
    );
    const res = await fetch(
      `${baseUrl}/apple-calendar/events?start=2026-03-29T00:00:00&end=2026-03-29T23:59:59`,
      {headers: {Authorization: `Bearer ${userToken}`}}
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {data: Array<{summary: string}>};
    expect(body.data).toHaveLength(1);
    expect(body.data[0].summary).toBe("Meeting");

    // Cleanup
    await CalendarConfig.deleteMany({owner: testData.user._id});
  });

  test("returns 400 when no calendars configured and none in query", async () => {
    // Ensure no config exists for admin
    await CalendarConfig.deleteMany({owner: testData.admin._id});

    const res = await fetch(
      `${baseUrl}/apple-calendar/events?start=2026-03-29T00:00:00&end=2026-03-29T23:59:59`,
      {headers: {Authorization: `Bearer ${adminToken}`}}
    );
    expect(res.status).toBe(400);
  });
});

// ─── POST /apple-calendar/events ─────────────────────────────────────────────

describe("POST /apple-calendar/events", () => {
  test("rejects unauthenticated requests", async () => {
    const res = await fetch(`${baseUrl}/apple-calendar/events`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        summary: "Test",
        startDate: "2026-03-29T14:00:00",
        endDate: "2026-03-29T15:00:00",
        calendarName: "Work",
      }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects missing required fields", async () => {
    const res = await fetch(`${baseUrl}/apple-calendar/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({summary: "Test"}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects missing summary", async () => {
    const res = await fetch(`${baseUrl}/apple-calendar/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        startDate: "2026-03-29T14:00:00",
        endDate: "2026-03-29T15:00:00",
        calendarName: "Work",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("creates an event", async () => {
    mockExec(
      "new-uid|||Team Sync|||March 29, 2026 2:00:00 PM|||March 29, 2026 3:00:00 PM|||Room B|||Agenda|||Work|||false||| "
    );
    const res = await fetch(`${baseUrl}/apple-calendar/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        summary: "Team Sync",
        startDate: "2026-03-29T14:00:00",
        endDate: "2026-03-29T15:00:00",
        calendarName: "Work",
        location: "Room B",
        notes: "Agenda",
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {data: {id: string; summary: string; location: string}};
    expect(body.data.id).toBe("new-uid");
    expect(body.data.summary).toBe("Team Sync");
    expect(body.data.location).toBe("Room B");
  });

  test("creates an event without optional fields", async () => {
    mockExec(
      "new-uid|||Quick Chat|||March 29, 2026 4:00:00 PM|||March 29, 2026 4:30:00 PM||| ||| |||Personal|||false||| "
    );
    const res = await fetch(`${baseUrl}/apple-calendar/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        summary: "Quick Chat",
        startDate: "2026-03-29T16:00:00",
        endDate: "2026-03-29T16:30:00",
        calendarName: "Personal",
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {data: {summary: string; location: string}};
    expect(body.data.summary).toBe("Quick Chat");
    expect(body.data.location).toBe("");
  });
});

// ─── Calendar Config CRUD ────────────────────────────────────────────────────

describe("calendar-configs CRUD", () => {
  test("creates a calendar config", async () => {
    const res = await fetch(`${baseUrl}/calendar-configs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        name: "my-config",
        enabledCalendars: ["Work", "Personal"],
        owner: testData.user._id.toString(),
      }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      data: {name: string; enabledCalendars: string[]; owner: string};
    };
    expect(body.data.name).toBe("my-config");
    expect(body.data.enabledCalendars).toEqual(["Work", "Personal"]);
  });

  test("lists calendar configs", async () => {
    const res = await fetch(`${baseUrl}/calendar-configs`, {
      headers: {Authorization: `Bearer ${userToken}`},
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {data: Array<{name: string}>};
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("rejects unauthenticated config creation", async () => {
    const res = await fetch(`${baseUrl}/calendar-configs`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        name: "sneaky",
        enabledCalendars: ["Work"],
        owner: testData.user._id.toString(),
      }),
    });
    expect(res.status).toBe(401);
  });
});
