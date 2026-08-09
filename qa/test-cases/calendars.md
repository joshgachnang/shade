# Test Cases: Calendar Management

**Screen(s):** CalendarsScreen
**Date:** 2026-07-11
**Author:** Claude
**Related Code:** frontend/app/(tabs)/calendars/index.tsx, backend/src/api/appleActions.ts, frontend/store/sdk.ts

## Prerequisites
- App is running on web (localhost:8082)
- User is authenticated
- iMessage edge agent is approved and has synced Apple Calendar (for non-empty states)

---

## TC-001: User can open the Calendar screen

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Click "Calendar" in the sidebar

**Expected Result:**
- Calendar screen loads with the "Calendar" heading, a Sync button, and an Add Event button.
- Upcoming events render grouped by day with time ranges ("All day" for all-day events), or the empty state shows "No upcoming events."

---

## TC-002: Calendar events load from the API

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Open the Calendar screen

**Expected Result:**
- A GET /calendarEvents request succeeds; only today-or-later events render, grouped by day in chronological order.

---

## TC-003: User can filter events by calendar

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual]

**Precondition:** At least two calendars have synced.

**Steps:**
1. Tap a calendar chip (e.g. "Work")
2. Tap "All"

**Expected Result:**
- After step 1: only that calendar's events show; the chip is highlighted.
- After step 2: all calendars' events show again.

---

## TC-004: User can open the add-event modal

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Click "Add Event"

**Expected Result:**
- Modal opens with Title, Calendar, Starts, Ends, and Location fields. The Calendar helper text lists only writable calendars.

---

## TC-005: Add Event is disabled until title and dates are entered

**Priority:** P1
**Type:** Validation
**Automation:** [automated]

**Steps:**
1. Open the add-event modal
2. Enter only a title
3. Enter start and end dates

**Expected Result:**
- After step 2: Add Event stays disabled.
- After step 3: Add Event becomes enabled.

---

## TC-006: User can create a timed event

**Priority:** P0
**Type:** Happy Path
**Automation:** [manual]

**Precondition:** Edge agent is online.

**Steps:**
1. Open the add-event modal
2. Enter a title, start '2026-08-01T09:00', end '2026-08-01T10:00'
3. Click Add Event

**Expected Result:**
- Modal closes. The event appears in Apple Calendar on the Mac at 9:00–10:00 local time and in the UI after the next sync.

---

## TC-007: User can create an all-day event with bare dates

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Open the add-event modal
2. Enter a title, start '2026-08-01', end '2026-08-01'
3. Click Add Event

**Expected Result:**
- The event is created as an all-day event on August 1 (not July 31) in Apple Calendar.

---

## TC-008: User can trigger a manual sync

**Priority:** P2
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Click "Sync"

**Expected Result:**
- Button shows "Syncing..." while the request runs; fresh events load afterward.

---

## TC-009: User can dismiss the add-event modal

**Priority:** P2
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Open the add-event modal
2. Click Cancel

**Expected Result:**
- Modal closes without creating an event.
