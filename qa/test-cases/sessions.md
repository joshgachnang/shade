# Test Cases: Zerg Sessions Dashboard

**Screen(s):** SessionsScreen
**Date:** 2026-09-26
**Author:** Claude
**Related Code:** frontend/app/(tabs)/sessions.tsx, frontend/store/sdk.ts, backend/src/api/zergSessions.ts, backend/src/orchestrator/services/zergSessions.ts

## Prerequisites
- App is running on web (localhost:8087 under Playwright, 8082 in dev)
- User is authenticated
- Backend can reach the zerg host over ssh (`AppConfig.zerg.sshHost`) for non-empty / non-error states; block that host or point `zerg.sshHost` at a bogus name to reproduce the unreachable state

---

## TC-001: User can open the Sessions screen

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Click "Sessions" in the sidebar

**Expected Result:**
- Sessions screen loads with the "Sessions" heading, a summary line ("N running of 12 · N need you"), and a Refresh button.
- Either the sessions list, the empty state "No zerg sessions.", or the unreachable banner is visible.

---

## TC-002: Sessions load from the API

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Open the Sessions screen

**Expected Result:**
- A GET /zerg/sessions request succeeds (200) and the loading spinner is replaced by the list, empty state, or banner.

---

## TC-003: Loading state

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: `zerg dash` returns in ~2 s; the spinner is too brief to assert reliably]

**Steps:**
1. Throttle the network in devtools
2. Open the Sessions screen

**Expected Result:**
- A spinner (`sessions-loading`) shows until the first response, then the content replaces it.

---

## TC-004: Empty state

**Priority:** P1
**Type:** Edge Case
**Automation:** [manual-only: requires zero live sessions on the zerg host]

**Precondition:** No zerg sessions exist (`zerg kill` everything).

**Steps:**
1. Open the Sessions screen

**Expected Result:**
- "No zerg sessions." is shown; summary reads "0 running of 12 · 0 need you"; no inbox section.

---

## TC-005: Needs-you sessions sort first and are marked

**Priority:** P0
**Type:** Happy Path
**Automation:** [manual-only: needs a blocked drone on the zerg host]

**Precondition:** One session is blocked on an AskUserQuestion, another is working.

**Steps:**
1. Open the Sessions screen

**Expected Result:**
- The blocked session is listed first with a red "needs you" badge and an activity badge "blocked · <age>"; the blocked-on text (the drone's question) is shown under it.
- The working session follows with a green "working · <age>" badge, its stage and PR.
- Every row ends with its attach command (`zerg attach <repo> <feature>`) and, when known, `claude --resume <id>`.

---

## TC-006: Pending inbox items are listed

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: needs a filed inbox item on the zerg host]

**Precondition:** A drone has filed an ask in `zerg inbox`.

**Steps:**
1. Open the Sessions screen and scroll below the list

**Expected Result:**
- "Inbox — decisions waiting on you" section shows one card per item with the question, its kind badge, the session, the recommendation, the options, and the note that answers happen in zerg.
- Summary line includes "N inbox pending".

---

## TC-007: zerg unreachable shows a banner, not a blank page

**Priority:** P0
**Type:** Error Handling
**Automation:** [manual-only: requires breaking ssh to the zerg host]

**Precondition:** `AppConfig.zerg.sshHost` points at an unreachable host.

**Steps:**
1. Open the Sessions screen

**Expected Result:**
- A red-bordered banner "zerg unreachable" with the ssh error text appears above the content.
- If the backend had a prior successful read, the stale rows remain visible with "Showing the last known state."; otherwise the empty state shows.
- The page never shows a generic error screen.

---

## TC-008: Refresh re-fetches

**Priority:** P1
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Open the Sessions screen
2. Click "Refresh"

**Expected Result:**
- The button reads "Refreshing..." while in flight, then "Refresh" again; a second GET /zerg/sessions completes with 200 and the "as of" time in the summary updates.

---

## TC-009: Screen polls while open

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: 15 s wait]

**Steps:**
1. Open the Sessions screen and wait 20 seconds without interacting

**Expected Result:**
- The "as of" time advances on its own (a new GET /zerg/sessions fired); the list does not flicker or scroll.

---

## TC-010: Long output lines and names wrap

**Priority:** P2
**Type:** Edge Case
**Automation:** [manual-only: needs a session with a long last line]

**Steps:**
1. Open the Sessions screen on a phone-width viewport with a session whose last line is 80 characters

**Expected Result:**
- The row wraps within its card; no horizontal scrolling; badges stay on the title line.

---

## TC-011: Keyboard access

**Priority:** P1
**Type:** Accessibility
**Automation:** [manual-only]

**Steps:**
1. Tab from the sidebar into the Sessions screen
2. Press Enter on the Refresh button

**Expected Result:**
- Refresh receives focus with a visible focus ring and Enter triggers a refetch; every row's activity badge has readable text (state and age), not color alone.
