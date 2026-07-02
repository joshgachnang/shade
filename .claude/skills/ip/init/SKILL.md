---
name: ip:init
description: "IP Init: Set up Implementation Plan tracking in current project"
disable-model-invocation: true
---

# IP Init: Set Up Implementation Plan Tracking

Set up the directory structure and tracking index for implementation plans in the current project. Does NOT create slash commands -- assumes `/ip` commands already exist globally.

## Argument

Optional project description or notes: `$ARGUMENTS`

## Before Starting

1. Identify the **project root** -- this is the current working directory
2. Check if IP tracking already exists by looking for `docs/implementationPlans/PLAN_INDEX.md`
   - If it exists, report what's already set up and ask what to regenerate
   - If it doesn't exist, proceed with full setup

## Step 1: Infer Project Context

1. Read `CLAUDE.md` if it exists -- note the project name, key conventions, commit style
2. Check `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or similar for project name
3. Look at recent git log for commit message style
4. Note the primary language and any existing docs structure
5. Check if `docs/implementationPlans/` already exists with plan files -- if so, scan them for the highest IP number to seed the index

## Step 2: Create Directory Structure

```bash
mkdir -p docs/implementationPlans/archive
mkdir -p docs/tasks
```

## Step 3: Create PLAN_INDEX.md

Create `docs/implementationPlans/PLAN_INDEX.md`:

```markdown
# Implementation Plan Index

Tracked implementation plans for {project_name}.

See `CLAUDE.md` for IP lifecycle stages and management guidelines.

## Active Plans

| IP | Title | Status | Effort | Priority |
|----|-------|--------|--------|----------|
| - | - | - | - | No active plans yet |

## Completed

| IP | Title | Completed | Notes |
|----|-------|-----------|-------|
| - | - | - | No completed plans yet |

## Deferred / Closed

| IP | Title | Status | Notes |
|----|-------|--------|-------|
| - | - | - | No deferred plans yet |

## Backlog

Low-priority or blocked items. Promote to Active when ready to plan.

| IP | Title | Notes |
|----|-------|-------|
| - | - | No backlog items yet |
```

If existing plan files were found in `docs/implementationPlans/`, populate the Active table with entries for each file, inferring IP numbers from filenames or assigning new ones.

## Step 4: Create IP_TEMPLATE.md

Only create if `docs/implementationPlans/IP_TEMPLATE.md` does not already exist. If it exists, skip this step and report it was found.

Create `docs/implementationPlans/IP_TEMPLATE.md`:

```markdown
# Implementation Plan: Title

**Status:** Open
**Priority:** Low | Medium | High
**Effort:** Small batch (1-2 days) | Big batch (1-2 weeks) | Epic (2+ weeks)
**IP:** IP-XXX

*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team.*

## Models

New or modified data models, schemas, relationships.

## APIs

Endpoints, permissions, special queries, bulk operations.

## Notifications

Push, email, in-app alerts -- who, when, what.

## UI

New screens/components, navigation flow, key interactions, states.

## Phases

How to break the work into phases/PRs.

## Feature Flags & Migrations

Feature flags, data migrations, rollout strategy.

## Activity Log & User Updates

What actions get logged, what surfaces as user updates.

## Not Included / Future Work

Explicitly out of scope.

---

## Task List

*Structured task breakdown. Each task should be independently implementable and testable.*

### Phase 1: [Phase Name]

- [ ] **Task 1.1**: [Short title]
  - Description: [What to implement]
  - Files: [Expected files to create/modify]
  - Depends on: [Other task IDs, or "none"]
  - Acceptance: [How to verify it's done]
```

## Step 5: Update Project CLAUDE.md

Read the project's `CLAUDE.md`. If it doesn't exist, create it with a minimal header.

**Check if an IP section already exists** by searching for `## Implementation Plan` or `## IP Management`. If found, skip and report.

Otherwise, **append** the following section:

```markdown

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

### Inline Annotations (`%%`)

Lines starting with `%%` in any file are **inline annotations from the user**. When you encounter them:
- Treat each `%%` annotation as a direct instruction
- Address **every** `%%` annotation in the file; do not skip any
- After acting on an annotation, remove the `%%` line from the file
- If an annotation is ambiguous, ask for clarification before acting
```

## Step 6: Summary

Report what was created:

```
## IP Tracking Initialized

### Files Created
- `docs/implementationPlans/PLAN_INDEX.md` -- Plan index
- `docs/implementationPlans/IP_TEMPLATE.md` -- IP file template (if not already present)
- `docs/implementationPlans/archive/` -- Archive directory
- `docs/tasks/` -- Task files directory
- `CLAUDE.md` -- Updated with IP conventions

### Next Steps
1. Run `/ip` to create your first implementation plan from a PRD
2. Run `/ip:status` to check the current state
```
