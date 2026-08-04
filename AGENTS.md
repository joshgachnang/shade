# Shade

AI-enhanced mental health/wellness app — React Native (Expo) + web target, built with a Node.js/Express backend.

## Stack

- **Frontend** (`frontend/`): React Native + Expo, web target, React Navigation for routing
- **Backend** (`backend/`): Node.js + Express, MongoDB, TypeScript, Bun
- **Testing**: Playwright for E2E, QA test cases in Markdown
- **Package manager**: Bun

## Development

```bash
bun install          # install dependencies
bun run dev          # start backend
bun run dev:test     # start backend with mocked LLM (AI harness)
```

## Testing — Read Before Writing Code

All testing rules live in `.claude/`:
- `.claude/auto-test-generation.md` — mandatory rules for generating tests alongside code
- `.claude/qa-test-case-format.md` — QA test case template and coverage requirements
- `.claude/playwright-rules.md` — selector strategy, RNW DOM mappings, async patterns

Read all three before writing or modifying any code. Test generation rules apply to every change.

AI testability harness: `bun run dev:test` runs the app offline with mocked LLM calls, driveable via `POST /command` and `/test/*` endpoints.

## Configuration — Always Use AppConfig

All runtime config (API keys, model names, webhooks, feature flags, URLs, thresholds) must live in `AppConfig` (`backend/src/models/appConfig.ts`) and be read via `loadAppConfig()`.

- `process.env` is only for bootstrap values: `MONGO_URI`, `PORT`, and secrets seeded by `hydrateEnvFromConfig`
- Never add new `process.env.FOO` reads without a corresponding `AppConfig` field
- Never hardcode API keys, model names, or URLs

## Implementation Plans

Plans live in `docs/implementationPlans/`, indexed in `PLAN_INDEX.md`. Completed plans archive to `docs/implementationPlans/archive/`. Commit format: `IP-XXX: Brief description`.

## Inline Annotations

Lines starting with `%%` are direct instructions from the user. Address every one, then remove the `%%` line.

## Code Style

- TypeScript throughout
- Bun for all scripts
- Prefer const arrow functions
- Named exports
- Early returns for error conditions
