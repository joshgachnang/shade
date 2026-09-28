# Test Cases: Brewery admin configuration

**Screen(s):** Admin > App Config > edit
**Date:** 2026-09-28
**Author:** Shade team
**Related Code:** backend/src/models/appConfig.ts, backend/src/adminConfig.ts, frontend/app/(tabs)/admin/[model]/[id].tsx

## Prerequisites

- Sign in as an administrator.
- Open the existing App Config record from Admin. The backend has created its default record.

---

## TC-001: View brewery defaults

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** The App Config record has default brewery settings.

**Steps:**
1. Open Admin, App Config, then the existing record.
2. Open the Brewery section if it is collapsed.

**Expected Result:**
- The Brewery editor shows `command: brewery`, `pollIntervalMs: 5000`, `narrationFlushMs: 4000`, `maxNarrationLines: 8`, `agents: ""`, and `stepSilenceAlertMin: 30`.

---

## TC-002: Save a brewery override

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: changes the shared App Config record]

**Precondition:** The Brewery section is expanded.

**Steps:**
1. Change `maxNarrationLines` from `8` to `5` in the Brewery JSON editor.
2. Select Save, then reopen the App Config record.
3. Restore `maxNarrationLines` to `8` and save.

**Expected Result:**
- Reopening after step 2 shows `maxNarrationLines: 5`; the other brewery settings retain their values.
- Reopening after step 3 shows the default value again.

---

## TC-003: Empty agent override

**Priority:** P1
**Type:** Edge Case
**Automation:** [manual-only: changes the shared App Config record]

**Precondition:** The Brewery section is expanded.

**Steps:**
1. Set `agents` to an empty string and save.
2. Reopen the record.

**Expected Result:**
- The editor still shows `agents: ""`; brewery uses its own agent configuration.

---

## TC-004: Malformed brewery JSON

**Priority:** P1
**Type:** Error Handling
**Automation:** [manual-only: generic admin editor parses JSON and displays API validation]

**Precondition:** The Brewery section is expanded.

**Steps:**
1. Replace the Brewery JSON with `{bad json`.
2. Select Save.

**Expected Result:**
- The record is not updated. The form displays an error; reopening the record shows the prior valid settings.

---

## TC-005: Keyboard access and long command

**Priority:** P2
**Type:** Accessibility
**Automation:** [manual-only: keyboard and screen-reader inspection]

**Precondition:** The App Config form is open.

**Steps:**
1. Use Tab and Enter to expand Brewery and focus its editor.
2. Enter a long executable path in `command`, then Tab to Save without selecting it.

**Expected Result:**
- Brewery, its editor, and Save are reachable by keyboard with visible focus and spoken labels.
- The long command remains readable in the editor and the unsaved value stays in the form.
