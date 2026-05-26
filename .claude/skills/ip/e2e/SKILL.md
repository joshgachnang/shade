---
name: ip:e2e
description: "IP: Generate E2E Tests — generate Playwright test files from acceptance criteria"
disable-model-invocation: true
---

# IP: Generate E2E Tests

Generate Playwright end-to-end tests from an IP's acceptance criteria. Uses the project's Playwright skill and testing conventions.

## Arguments

$IP: Optional path to an IP file with acceptance criteria. If not provided, look for the IP in the current conversation context or ask the user which IP to use.

## Instructions

### 1. Load the IP and acceptance criteria

- If `$IP` is provided, read the file
- Otherwise, check if an IP was loaded in the current conversation
- If neither, list available IPs from `docs/implementationPlans/` and ask which one to use
- The IP **must** have an `## Acceptance Criteria` section. If it doesn't, tell the user to run `/ip:acceptance` first.

### 2. Research the codebase

Before writing tests, understand the existing test setup:

- Check if `playwright.config.ts` exists — if not, note that it needs to be created
- Check if `e2e/` directory exists and what tests are already there
- Check for `e2e/helpers/` and `e2e/fixtures/` for reusable utilities
- Check for `e2e/auth.setup.ts` to understand auth patterns
- Look at existing test files to match the style and patterns in use
- Check if the testIDs listed in acceptance criteria already exist in the component code

### 3. Plan the test files

Map acceptance criteria to test files:

- **One test file per feature area** (matching the `### Feature:` groups in acceptance criteria)
- File naming: `e2e/{feature-name}.spec.ts` (kebab-case)
- Group related ACs into `test.describe()` blocks

Present the plan to the user:

```
## E2E Test Plan

### Files to create:
- `e2e/feature-name.spec.ts` — [count] tests from [AC numbers]
- `e2e/another-feature.spec.ts` — [count] tests from [AC numbers]

### Missing testIDs (must be added to components first):
- `screen-element-name` — [component file if known]
- ...

### Missing infrastructure:
- [ ] playwright.config.ts (will create)
- [ ] e2e/helpers/auth.ts (will create)
- ...
```

Ask: "Should I generate these test files? Any changes to the plan?"

### 4. Generate test files

For each test file, follow these rules strictly:

**Structure:**
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature: [Feature Name]', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to starting screen
    // Wait for screen to be visible
  });

  // One test per acceptance criterion
  test('[AC title — as user behavior]', async ({ page }) => {
    // Steps from the AC, translated to Playwright actions
    // Expected results as assertions
  });
});
```

**Translation rules (AC → Playwright):**

| AC Step | Playwright Code |
|---------|----------------|
| Navigate to [screen] | `await page.goto('/path'); await page.getByTestId('screen-name').waitFor({ state: 'visible' });` |
| Tap / click [element] | `await page.getByTestId('testid').click();` |
| Type [text] into [field] | `await page.getByTestId('testid').fill('text');` |
| Toggle [switch] | `await page.getByTestId('testid').click();` |
| See [text/element] | `await expect(page.getByTestId('testid')).toBeVisible();` |
| See text [content] | `await expect(page.getByTestId('testid')).toHaveText(/content/i);` |
| Don't see [element] | `await expect(page.getByTestId('testid')).not.toBeVisible();` |
| See [N] items in list | `await expect(page.getByTestId('list').getByTestId(/^item-/)).toHaveCount(N);` |
| Wait for loading | `await page.getByTestId('loading-indicator').waitFor({ state: 'hidden' });` |
| Page URL contains [path] | `await expect(page).toHaveURL(/path/);` |

**Mandatory rules:**
- Use `getByTestId()` as primary selector — never class names or deep selectors
- Never use `waitForTimeout()` — always wait for element state
- Wait for screen visibility after every navigation
- Wait for `networkidle` after data-fetching actions when appropriate
- Add `// AC-N: [title]` comment above each test for traceability
- Mark tests that need auth setup with the appropriate Playwright project dependency
- Use `test.skip()` with a reason for any AC that can't be automated yet (e.g., requires native device features)

### 5. Report missing testIDs

After generating tests, produce a checklist of testIDs that need to be added to components:

```markdown
## testIDs to Add

These testIDs are referenced in the generated tests but may not exist in the app yet.
Add them before running the tests.

### [Screen Name]
- [ ] `screen-element-name` on `<ComponentType>` — [purpose]
- [ ] `screen-another-element` on `<ComponentType>` — [purpose]
```

If you can identify the component files where testIDs should be added, include the file paths.

### 6. Summary

```
## E2E Tests Generated

### Files created:
- `e2e/feature-name.spec.ts` — [count] tests
- ...

### Coverage:
- P0 criteria covered: [count]/[total]
- P1 criteria covered: [count]/[total]
- P2 criteria covered: [count]/[total]
- Skipped (not automatable): [count] — [reasons]

### Before running tests:
1. Add missing testIDs to components (see checklist above)
2. Ensure `playwright.config.ts` is configured
3. Start the dev server
4. Run: `bunx playwright test`

### After tests pass:
Run `/ip:verify` to verify the full implementation
```
