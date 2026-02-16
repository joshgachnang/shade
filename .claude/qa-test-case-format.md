# QA Test Case Format

Every test case file follows this structure. Write these so a QA person who has never seen the code can execute them.

## Template

```markdown
# Test Cases: {Feature Name}

**Screen(s):** {Screen name(s) involved}
**Date:** {YYYY-MM-DD}
**Author:** Claude
**Related Code:** {path/to/component.tsx}

## Prerequisites
- {What state the app needs to be in before testing}
- {Any test accounts, data, or environment setup needed}
- {e.g., "Logged in as a standard user", "At least 3 items in the todo list"}

---

## TC-{NNN}: {Short descriptive name}

**Priority:** P0 | P1 | P2
**Type:** Happy Path | Edge Case | Error Handling | Boundary | Accessibility
**Automation:** [automated] | [manual-only: {reason}]

**Precondition:** {Starting state for this specific test}

**Steps:**
1. {Exact action the tester takes}
2. {Next action}
3. {Next action}

**Expected Result:**
- {What the tester should observe after each significant step}
- {Be specific: "Error message 'Email is required' appears below the email field", not "error shows"}

**Test Data:**
| Field | Value | Notes |
|-------|-------|-------|
| Email | test@example.com | Valid format |
| Password | short | Less than minimum 8 chars |

---
```

## Priority Definitions

- **P0 — Blocks release.** Core user flows: login, signup, primary CRUD, payment, navigation between main screens. If this breaks, users can't use the app.
- **P1 — Should fix before release.** Secondary flows, important edge cases, error handling for common mistakes. The app works but the experience is degraded.
- **P2 — Fix when possible.** Minor edge cases, cosmetic issues, unlikely error states, accessibility improvements beyond basic compliance.

## Test Type Coverage Requirements

For every new feature, you MUST cover at minimum:

| Type | What to test | Required? |
|------|-------------|-----------|
| **Happy Path** | The main success scenario end-to-end | Always (P0) |
| **Validation / Error** | Every form field with invalid input, empty required fields, server errors | Always for forms (P0) |
| **Empty State** | What the screen looks like with no data | Always for list/data screens (P1) |
| **Loading State** | What appears while data is being fetched | Always for async screens (P1) |
| **Edge Cases** | Long text, special characters, max-length inputs, rapid tapping | At least 2 per feature (P1-P2) |
| **Boundary** | Min/max values, exactly-at-limit inputs, pagination boundaries | When numeric or list-based (P1) |
| **Accessibility** | Screen reader labels, keyboard navigation, touch target sizes | At least 1 per screen (P1) |
| **Destructive Actions** | Delete, cancel, back-during-edit, unsaved changes warning | Always when applicable (P0) |

---

## Examples

### Happy Path

```markdown
## TC-001: User successfully creates a new todo item

**Priority:** P0
**Type:** Happy Path
**Automation:** [automated]

**Precondition:** User is logged in and on the Home screen. Todo list may be empty or populated.

**Steps:**
1. Tap the "+" floating action button in the bottom-right corner
2. Wait for the "New Todo" form to appear
3. Tap the "Title" text field and type "Buy groceries"
4. Tap the "Notes" text field and type "Milk, eggs, bread"
5. Tap the "Due Date" field and select tomorrow's date
6. Tap the "Save" button

**Expected Result:**
- After step 2: Form slides up with empty Title, Notes, and Due Date fields. Save button is visible but disabled.
- After step 3: Save button becomes enabled (title is the only required field).
- After step 6: Form dismisses. Home screen shows "Buy groceries" at the top of the todo list with tomorrow's date shown. A success toast "Todo created" appears briefly.

**Test Data:**
| Field | Value |
|-------|-------|
| Title | Buy groceries |
| Notes | Milk, eggs, bread |
| Due Date | {tomorrow's date} |
```

### Edge Case

```markdown
## TC-007: User enters extremely long todo title

**Priority:** P2
**Type:** Edge Case
**Automation:** [automated]

**Precondition:** User is on the "New Todo" form.

**Steps:**
1. Tap the "Title" field and type a 500-character string
2. Tap "Save"

**Expected Result:**
- After step 1: Text field accepts input up to 200 characters, then stops accepting input. Character counter shows "200/200" in red.
- After step 2: Todo is created successfully with the truncated 200-character title. No error, no crash.
```

### Manual-Only

```markdown
## TC-012: Push notification navigates to correct todo item

**Priority:** P1
**Type:** Happy Path
**Automation:** [manual-only: requires real push notification delivery, not available on web]

**Precondition:** User is logged in. App is in the background. A todo item "Team meeting" exists with a reminder set for the current time.

**Steps:**
1. Wait for the push notification to appear in the device notification tray
2. Tap the notification

**Expected Result:**
- After step 1: Notification shows title "Reminder" and body "Team meeting" with the app icon.
- After step 2: App opens directly to the "Team meeting" detail screen, not the home screen.
```
