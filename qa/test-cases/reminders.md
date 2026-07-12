# Test Cases: Reminders Management

**Screen(s):** RemindersScreen
**Date:** 2026-07-11
**Author:** Claude
**Related Code:** frontend/app/(tabs)/reminders/index.tsx, backend/src/api/appleActions.ts, frontend/store/sdk.ts

## Prerequisites
- App is running on web (localhost:8082)
- User is authenticated
- iMessage edge agent is approved and has synced Apple Reminders (for non-empty states)

---

## TC-001: User can open the Reminders screen

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is logged in.

**Steps:**
1. Click "Reminders" in the sidebar

**Expected Result:**
- Reminders screen loads with the "Reminders" heading, a Sync button, and an Add Reminder button.
- Synced reminders render as cards (title, list name, due-date badge), or the empty state shows "No open reminders."

---

## TC-002: Reminders load from the API

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Open the Reminders screen

**Expected Result:**
- A GET /reminders request succeeds and open (non-completed, active) reminders render sorted by due date, dateless ones last.

---

## TC-003: User can filter reminders by list

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual]

**Precondition:** At least two reminder lists have synced.

**Steps:**
1. Observe the list-filter chips under the header
2. Tap a list chip (e.g. "Groceries")
3. Tap "All"

**Expected Result:**
- After step 2: only reminders from that list show; the chip is highlighted.
- After step 3: reminders from every list show again.

---

## TC-004: User can open the add-reminder modal

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Click "Add Reminder"

**Expected Result:**
- Modal opens with Title, List, Due date, and Notes fields, plus Add Reminder / Cancel buttons.

---

## TC-005: Add Reminder is disabled without a title

**Priority:** P1
**Type:** Validation
**Automation:** [automated]

**Steps:**
1. Open the add-reminder modal
2. Leave Title blank and observe the Add Reminder button
3. Type a title

**Expected Result:**
- After step 2: Add Reminder button is disabled.
- After step 3: Add Reminder button becomes enabled.

---

## TC-006: User can create a reminder

**Priority:** P0
**Type:** Happy Path
**Automation:** [manual]

**Precondition:** Edge agent is online.

**Steps:**
1. Open the add-reminder modal
2. Enter a title, optionally a list name and due date ('2026-07-20' or '2026-07-20T09:00')
3. Click Add Reminder

**Expected Result:**
- Modal closes. The reminder appears in Apple Reminders on the Mac (correct list, correct local due date) and shows in the UI after the next sync.

---

## TC-007: User can complete a reminder

**Priority:** P0
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Click the check icon on a reminder card

**Expected Result:**
- The reminder disappears from the open list immediately (optimistic update) and is marked completed in Apple Reminders on the Mac.

---

## TC-008: User can delete a reminder

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Click the trash icon on a reminder card

**Expected Result:**
- The reminder disappears from the list immediately and is deleted from Apple Reminders on the Mac.

---

## TC-009: User can trigger a manual sync

**Priority:** P2
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Click "Sync"

**Expected Result:**
- Button shows "Syncing..." while the request runs; a sync_now command is queued for the edge agent and fresh data loads afterward.

---

## TC-010: User can dismiss the add-reminder modal

**Priority:** P2
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Open the add-reminder modal
2. Click Cancel

**Expected Result:**
- Modal closes without creating a reminder.
