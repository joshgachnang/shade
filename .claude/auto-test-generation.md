# Automatic Test Generation

## MANDATORY: When Writing or Modifying Code, Always Generate Tests

Every time you create a new screen, component, feature, or modify existing behavior, you MUST produce test artifacts before considering the task complete. This is not optional — shipping code without tests is shipping incomplete work.

**Two outputs are required:**

1. **QA Test Cases** (always) → human-readable Markdown in `qa/test-cases/`
2. **Playwright Tests** (when applicable) → automated E2E tests in `e2e/`

## Scope: Frontend Flows Only

QA test cases and Playwright tests cover what the user sees and does in the UI. Backend/API correctness (response codes, validation logic, data integrity) is covered by normal backend unit and integration tests — NOT by these QA test cases. If a frontend flow depends on an API response, the test case describes the *UI behavior* for that response (e.g., "error banner appears"), not whether the API returns the correct status code.

## Decision: When to Write Playwright Tests

Write a Playwright test when ALL of these are true:
- The feature is a user-facing screen or flow (not a utility function or hook)
- It involves interactions a user would do in a browser (tap, type, navigate, scroll)
- The feature runs on web (not a native-only feature like camera, push notifications)

Skip Playwright (QA test case only) when:
- The feature is purely native (no web target)
- It's a styling-only change with no behavior change
- It involves device hardware (camera, GPS, biometrics, NFC)
- It requires third-party auth flows you can't mock (OAuth popups, CAPTCHA)

## Workflow: The Exact Steps to Follow

When you finish writing or modifying feature code:

1. **Add `testID` props** to every interactive and assertable element in the code you just wrote. Follow the naming convention: `{screen}-{element}-{qualifier}`.

2. **Write the QA test case file** at `qa/test-cases/{feature}.md` using the format in `qa-test-case-format.md`.

3. **If Playwright-eligible**, write the automated test at `e2e/{feature}.spec.ts`. Mark the corresponding QA test cases as `[automated]`.

4. **If you wrote a Playwright test, run it.** Fix failures. Don't leave red tests.

5. **Summarize** what you tested and what's left for manual QA only.

## File Organization

```
project/
├── qa/
│   └── test-cases/
│       ├── auth-login.md
│       ├── auth-signup.md
│       ├── todo-create.md
│       ├── todo-edit.md
│       ├── todo-delete.md
│       ├── settings-profile.md
│       └── _index.md              ← Auto-generated table of contents
├── e2e/
│   ├── fixtures/
│   ├── helpers/
│   ├── auth.setup.ts
│   ├── auth-login.spec.ts
│   ├── todo-create.spec.ts
│   └── todo-edit.spec.ts
├── playwright.config.ts
├── claude.md
└── claude/
    ├── auto-test-generation.md
    ├── qa-test-case-format.md
    ├── playwright-rules.md
    └── commands.md
```

## The `_index.md` File

Every time you add or update a test case file, regenerate `qa/test-cases/_index.md`:

```markdown
# QA Test Case Index

Last updated: {YYYY-MM-DD}

| File | Feature | # Cases | P0 | P1 | P2 | Automated |
|------|---------|---------|----|----|-----|-----------|
| auth-login.md | Login flow | 8 | 3 | 3 | 2 | 5/8 |
| todo-create.md | Create todo | 6 | 2 | 2 | 2 | 4/6 |
| ... | ... | ... | ... | ... | ... | ... |

**Total:** {N} test cases | {N} P0 | {N} P1 | {N} P2 | {N}/{N} automated
```
