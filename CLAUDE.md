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
- `docs/testing/ai-harness.md` — AI testability harness: run the app offline with mocked LLM calls (`bun run dev:test`), drive it via `POST /command` + `/test/*`, observe results. Use `/shade-harness` (project skill) for the quick loop.

**Read all three files before writing or modifying any code.** The auto-test-generation rules apply to every code change — not just when a command is invoked.

---

## Implementation Plan (IP) Management

Implementation plans are tracked in `docs/implementationPlans/`. Each IP has a dedicated file and is indexed in `PLAN_INDEX.md`.

### IP Lifecycle

| Stage | Description |
|-------|-------------|
| **Planned** | Identified but not yet designed |
| **Design** | Actively designing (PRD ingested, shaping) |
| **Open** | Shaped and ready for implementation |
| **In Progress** | Currently being implemented |
| **Pending Verification** | Code complete, awaiting verification |
| **Complete** | Verified working, ready to archive |
| **Deferred** | Postponed (low priority or blocked) |
| **Closed** | Won't implement (superseded or not needed) |

### Workflow Skills (coffee pipeline)

The `/ip` skill family is retired; planning and delivery run through these project skills (`.claude/skills/`):

| Skill | Purpose |
|-------|---------|
| `/blend` | Turn a feature request/spec into an IP. **Use this whenever the user asks for a new feature.** Simple, unambiguous requests skip all confirmation pauses and go straight to a plan (with stated assumptions); in-depth or ambiguous ones get the full research → blocking-questions → shape flow. Also owns lifecycle ops (init/explore/status/close). |
| `/roast` | Implement an approved IP via strict TDD. Always starts by creating a dedicated git worktree for the PR and running `bun bootstrap` at its root. |
| `/pour` | Commit, push, open the draft PR, then hand off to dialin. |
| `/dialin` | Reactive PR loop: watch/fix CI and review comments until mergeable (15 min window). |
| `/cupping` | Independent verification of a finished implementation against the IP, with evidence. |

### Conventions

- **IP files**: `docs/implementationPlans/{Title-Case-Name}.md` (e.g. `Zoom-Integration-Mvp.md`)
- **Template**: `docs/implementationPlans/IP_TEMPLATE.md`
- **Task files**: `docs/tasks/{feature-name}.md` (created by `/blend`)
- **Commit format**: `IP-XXX: Brief description`
- **Numbering**: Next number = highest across all index sections + 1
- **Source of truth**: IP file status > index (if discrepancy, file wins)
- **Archive**: Completed IPs move to `docs/implementationPlans/archive/`
- **Environment setup**: every project supports `bun bootstrap` at the repo root — run it in any fresh clone or worktree before working.

## Skills

New skills (slash commands) must be created in the project directory at `.claude/skills/<skill-name>/SKILL.md`, not in the personal `~/.claude/skills/` directory. Project skills are checked into the repo and shared across sessions.

---

## Configuration — ALWAYS use `AppConfig`

**All runtime configuration** — API keys, model names, webhooks, feature flags, service credentials, base URLs, thresholds — **must** live in the `AppConfig` model (`backend/src/models/appConfig.ts`) and be read via `loadAppConfig()`.

- Environment variables are **only** for bootstrap-level values needed before the DB is available: `MONGO_URI`, `PORT`, and the handful of secrets seeded into `process.env` by `hydrateEnvFromConfig` for third-party SDKs that read `process.env` synchronously.
- When you need a new piece of config:
  1. Add the field to `backend/src/models/appConfig.ts` and `backend/src/types/models/appConfigTypes.ts`.
  2. If it has to end up in `process.env` for an SDK, extend `hydrateEnvFromConfig` + `RESTART_REQUIRED_FIELDS` in `backend/src/utils/configEnv.ts`.
  3. Surface it in the admin UI so operators can edit it without a deploy.
- **Do not** add new `process.env.FOO` reads in application code without a corresponding `AppConfig` field. Do not hardcode API keys, model names, or URLs.
- When agents ask "where does this config come from?", the answer is always `AppConfig`.

---

### Inline Annotations (`%%`)

Lines starting with `%%` in any file are **inline annotations from the user**. When you encounter them:
- Treat each `%%` annotation as a direct instruction
- Address **every** `%%` annotation in the file; do not skip any
- After acting on an annotation, remove the `%%` line from the file
- If an annotation is ambiguous, ask for clarification before acting
