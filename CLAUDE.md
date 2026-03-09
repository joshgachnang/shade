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

### Slash Commands

| Command | Purpose |
|---------|---------|
| `/ip` | Full IP workflow (ingest -> research -> shape -> plan -> generate) |
| `/ip:init` | Set up IP tracking in current project |
| `/ip:ingest` | Ingest a PRD |
| `/ip:shape` | Shape & question -- narrow scope, surface risks |
| `/ip:plan` | Walk through plan sections interactively |
| `/ip:generate` | Generate final plan + task list |
| `/ip:explore` | Explore project -- overview, IP history, recent activity |
| `/ip:deep` | Deep parallel analysis -- 4 agents explore from different angles |
| `/ip:status` | Show active IPs with status and grooming |
| `/ip:verify` | Post-implementation: commit, proofread, verify |
| `/ip:attack` | Adversarial review -- OpenAI Codex red-teams the plan |
| `/ip:close` | Complete/close an IP, archive file, update index |

### Conventions

- **IP files**: `docs/implementationPlans/{Title-Case-Name}.md` (e.g. `Zoom-Integration-Mvp.md`)
- **Template**: `docs/implementationPlans/IP_TEMPLATE.md`
- **Task files**: `docs/tasks/{feature-name}.md` (created by `/ip:generate`)
- **Commit format**: `IP-XXX: Brief description`
- **Numbering**: Next number = highest across all index sections + 1
- **Source of truth**: IP file status > index (if discrepancy, file wins)
- **Archive**: Completed IPs move to `docs/implementationPlans/archive/`

## Skills

New skills (slash commands) must be created in the project directory at `.claude/skills/<skill-name>/SKILL.md`, not in the personal `~/.claude/skills/` directory. Project skills are checked into the repo and shared across sessions.

---

### Inline Annotations (`%%`)

Lines starting with `%%` in any file are **inline annotations from the user**. When you encounter them:
- Treat each `%%` annotation as a direct instruction
- Address **every** `%%` annotation in the file; do not skip any
- After acting on an annotation, remove the `%%` line from the file
- If an annotation is ambiguous, ask for clarification before acting
