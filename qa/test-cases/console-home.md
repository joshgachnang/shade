# Test Cases: Console Home & Merged Sidebar

**Screen(s):** HomeScreen (console chat), console pane screens (Activity, Approvals, System, Memory, Traces, Cron, Config)
**Date:** 2026-07-11
**Author:** Claude
**Related Code:** frontend/app/(tabs)/index.tsx, frontend/app/(tabs)/_layout.tsx, frontend/components/console/ConsoleScreen.tsx, frontend/components/console/ConsoleContext.tsx

## Prerequisites
- App is running on web (localhost:8082)
- User is authenticated

---

## TC-001: Console chat is the home page

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Log in and land on the home page

**Expected Result:**
- The Shade Console chat renders as home: status bar (Sandboxed/Egress/Online badges, alerts bell, kill switch) on top, chat column with composer below. No "Welcome to Shade" placeholder.

---

## TC-002: Sidebar merges console panes and app pages

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Observe the sidebar

**Expected Result:**
- One sidebar contains both console panes (Home, Activity, Approvals, System, Memory, Traces, Cron; Config at bottom) and app pages (Search, Movies, Features, Reminders, Calendar; Admin, Profile at bottom). The console has no second internal rail or tab bar.

---

## TC-003: Console panes open from the sidebar

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Click Activity, then Approvals, then System in the sidebar

**Expected Result:**
- Each pane renders with the console status bar on top. Approvals shows a numeric badge in the sidebar when approvals are pending.

---

## TC-004: Console state survives pane navigation

**Priority:** P1
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. On Home, engage the kill switch (click twice: arm, then confirm)
2. Navigate to Activity
3. Restore agents

**Expected Result:**
- The kill banner / restore button persist across navigation (one shared console state). Restore returns the console to live state everywhere.

---

## TC-005: /console redirects to home

**Priority:** P2
**Type:** Happy Path
**Automation:** [automated]

**Steps:**
1. Navigate directly to /console

**Expected Result:**
- Redirects to the home page showing the console chat.

---

## TC-006: Chat composer works on home

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Type a message in the composer and send

**Expected Result:**
- Message appears in the stream; the (demo) agent reply flow runs; toasts render above the page without blocking the sidebar.

---

## TC-007: Alerts popover opens from the status bar

**Priority:** P2
**Type:** Happy Path
**Automation:** [manual]

**Steps:**
1. Click the bell icon in the status bar

**Expected Result:**
- Alerts popover opens; unread count clears when marked read; popover renders above pane content.
