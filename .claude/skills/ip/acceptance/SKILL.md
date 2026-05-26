---
name: ip:acceptance
description: "IP: Acceptance Criteria — generate structured acceptance criteria for manual + automated testing"
disable-model-invocation: true
---

# IP: Acceptance Criteria

Generate structured acceptance criteria for an implementation plan. The criteria should be specific enough for a human to manually test AND for a bot to translate into Playwright E2E tests.

## Arguments

$IP: Optional path to an existing IP file. If not provided, look for the IP in the current conversation context or ask the user which IP to use.

## Instructions

### 1. Load the IP

- If `$IP` is provided, read the file
- Otherwise, check if an IP was generated in the current conversation
- If neither, list available IPs from `docs/implementationPlans/` and ask which one to use

### 2. Check for existing acceptance criteria

- If the PRD or IP already has an `## Acceptance Criteria` section, read it carefully
- Also check each task in the Task List for `Acceptance:` lines
- These are your starting point — you'll expand and formalize them, not replace them

### 3. Analyze the IP to identify testable behaviors

Walk through each section of the IP and identify user-facing behaviors:

- **Models & APIs**: What responses should the API return? What validation errors should occur?
- **UI**: What should the user see? What happens when they interact with elements?
- **Notifications**: What triggers them? What content appears?
- **Permissions**: What should different roles see/not see?
- **Error states**: What happens when things fail?
- **Edge cases**: Empty states, boundary values, concurrent actions

### 4. Write acceptance criteria

Write criteria in a dual-format that works for both humans and bots:

```markdown
## Acceptance Criteria

### Feature: [Feature area name]

#### AC-1: [Short descriptive title]
**Priority:** P0 | P1 | P2
**Screen:** [screen name, e.g., "Login Screen"]
**Preconditions:**
- [Any setup needed before testing, e.g., "User is logged in", "At least 3 items exist"]

**Steps:**
1. [Navigate to / open / tap specific element]
2. [Perform action — be specific about what to type, tap, select]
3. [Observe result]

**Expected results:**
- [ ] [Specific, observable outcome — what the user sees]
- [ ] [Another expected outcome]

**testIDs needed:** `screen-element-qualifier`, `screen-another-element`

---
```

### Format rules

- **Steps must reference specific UI elements** using the `{screen}-{element}-{qualifier}` testID naming convention
- **Expected results must be visually verifiable** — things a human can see AND a bot can assert (`toBeVisible`, `toHaveText`, `toHaveCount`, etc.)
- **Include the `testIDs needed` line** listing every testID the test will need. This serves as a checklist for the developer to add testIDs to components before tests can run.
- **Priority levels:**
  - **P0**: Core happy path — feature is broken without this
  - **P1**: Important flows — error handling, validation, key edge cases
  - **P2**: Nice-to-have — polish, edge cases, minor interactions
- **Group by feature area** (e.g., "User Authentication", "Item Management", "Notifications")

### 5. Cover these categories

Ensure you have at least one criterion for each:

- **Happy path**: The main flow works end to end
- **Validation**: Required fields, format checks, boundary values
- **Error handling**: Network errors, server errors, invalid states
- **Empty states**: What shows when there's no data?
- **Permissions** (if applicable): Different roles see different things
- **Navigation**: Moving between screens works correctly
- **Data persistence**: Changes are saved and visible after refresh

### 6. Add the section to the IP

Insert the `## Acceptance Criteria` section into the IP file, after the main plan sections but before the `## Task List` section.

### 7. Summary

Present a summary:

```
## Acceptance Criteria Generated

**Added to**: [IP file path]

### Coverage
- P0 (critical): [count] criteria
- P1 (important): [count] criteria
- P2 (nice-to-have): [count] criteria
- Total testIDs needed: [count]

### Next Steps
1. Review criteria with the team
2. Ensure all listed testIDs are added to components
3. Run `/ip:e2e` to generate Playwright tests from these criteria
```

Ask: "Want to adjust any criteria or add coverage for something I missed?"
