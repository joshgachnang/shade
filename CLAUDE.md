# Project Rules

## Tech Stack
- React Native (Expo) with Web target
- React Navigation for routing
- Playwright for E2E testing
- QA test cases in Markdown

---

## Testing

All testing rules, formats, and commands are in the `.claude/` directory:

- `.claude/auto-test-generation.md` — MANDATORY rules for generating tests alongside code
- `.claude/qa-test-case-format.md` — QA test case template, priority definitions, coverage requirements, and examples
- `.claude/playwright-rules.md` — Selector strategy, RNW DOM mappings, async patterns, and config

**Read all three files before writing or modifying any code.** The auto-test-generation rules apply to every code change — not just when a command is invoked.
