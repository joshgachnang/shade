# Test Cases: Features brewery progress

**Screen(s):** Features
**Date:** 2026-09-30
**Author:** Shade team
**Related Code:** frontend/app/(tabs)/features/index.tsx

## Prerequisites
- Sign in and open Features.
- Use synthetic feature fixtures described below; browser automation intercepts only HTTP responses using the real GET /features envelope: `{data: [...], limit: 100, more: false, total: N}`.
- Automated suite: `e2e/features-brewery.spec.ts`.

---

## TC-001: Approval, phase and PR

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** A feature reports awaiting_approval, phase review, PR 42 and https://example.invalid/pull/42.

**Steps:**
1. Open Features.
2. Select Open PR #42.

**Expected Result:**
- The badge reads awaiting approval and the phase reads Brewery: review. The PR opens in a new tab; Features remains open.

---

## TC-002: Legacy feature navigation

**Priority:** P1
**Type:** Edge Case
**Automation:** [automated]

**Precondition:** A legacy feature has no brewery metadata and one of two steps complete.

**Steps:**
1. Open Features.
2. Select the legacy feature card.

**Expected Result:**
- The card shows 1 / 2 steps (50%) and the current step; no brewery phase or PR appears. The feature detail screen opens.

---

## TC-003: Missing metadata and long phase

**Priority:** P1
**Type:** Edge Case
**Automation:** [automated]

**Precondition:** Use a run with no phase or PR and an error message, then one with a long phase containing <notes> & feedback.

**Steps:**
1. Open Features for each fixture.

**Expected Result:**
- Missing fields are omitted, the error message is visible, and the long phase is displayed as literal text.

---

## TC-004: Unavailable PR destination

**Priority:** P1
**Type:** Error Handling
**Automation:** [automated]

**Precondition:** PR 42 has a missing, blank, malformed, javascript: or file: URL.

**Steps:**
1. Open Features.

**Expected Result:**
- PR #42 appears as plain text with no clickable link for each invalid destination.

---

## TC-005: Invalid PR numbers

**Priority:** P1
**Type:** Boundary
**Automation:** [automated]

**Precondition:** Runs have PR numbers 0, -1 and 1.5.

**Steps:**
1. Open Features.

**Expected Result:**
- Cards appear without PR text or links.

---

## TC-006: Loading and empty list

**Priority:** P1
**Type:** Empty State / Loading State
**Automation:** [automated]

**Precondition:** Delay the Features response, then return an empty list.

**Steps:**
1. Open Features.
2. Release the response.

**Expected Result:**
- A loading spinner appears, followed by No features yet. Add one to get started. The spinner disappears.

---

## TC-007: Keyboard link activation

**Priority:** P1
**Type:** Accessibility
**Automation:** [automated]

**Precondition:** A run has a valid PR number and HTTP(S) URL.

**Steps:**
1. Open Features.
2. Focus the PR link using the keyboard.
3. Press Enter.

**Expected Result:**
- The link is named Open PR #42, receives focus, and opens the PR without navigating the feature card.

---

## TC-008: Native PR navigation

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: requires iOS or Android device]

**Precondition:** A native app user can access Features and a run with a valid PR.

**Steps:**
1. Open Features on iOS or Android.
2. Tap Open PR #42.
3. Return to Shade.

**Expected Result:**
- The platform opens the PR URL. Returning to Shade shows Features; tapping the card still opens feature details.

---
