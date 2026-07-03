# Implementation Plan: Agent Memory & Learning

**Status:** Open
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-008

**Context:** From `docs/architecture/assessment-and-hermes.md` (Hermes recommendation #1 / arch gap #2). Shade agents only see the last ~2 hours of messages plus static memory files. This IP adds searchable history, an agent-curated user profile, and a self-authored skills library — modeled on Hermes Agent's memory/skills loop, built on Shade's existing `orchestrator/memory.ts` foundation (SOUL.md, global CLAUDE.md, group CLAUDE.md, `canWriteGlobalMemory`/`canWriteGroupMemory` gates).

**Assumptions made (no open questions):**
- History search uses a MongoDB text index on `Message.content` — no Atlas Search dependency, no transcript-file search in v1.
- Skills are global (one shared library at `SHADE_DATA_DIR/skills/`), not per-group, in v1.
- `USER.md` is a single global user profile (Shade is single-user), stored next to the global CLAUDE.md, writable only from the main group.
- Size limits are enforced in characters (~4 chars/token): 3,200 chars for USER.md, 6,000 chars per memory file, 8,000 chars per skill.
- No embeddings/vector search in v1 — text index + LLM-side filtering is enough at Shade's message volume.

## Models

**No new Mongoose models.** Two modifications:

1. `backend/src/models/message.ts` — add a text index:
   ```ts
   schema.index({content: "text"});
   ```
2. `backend/src/models/appConfig.ts` + `backend/src/types/models/appConfigTypes.ts` — add:
   ```ts
   memory: {
     enabled: {type: Boolean, default: true},          // master switch for new tools + prompt block
     maxFileChars: {type: Number, default: 6000},       // per memory file (global/group/user)
     maxSkillChars: {type: Number, default: 8000},      // per skill file
     historySearchLimit: {type: Number, default: 8},    // max search_history results
   }
   ```
   (Not restart-required; read via `loadAppConfig()` at tool-call time.)

**Filesystem additions** (`backend/src/config.ts`):
- `paths.skills` getter → `path.join(paths.data, "skills")`, created during boot filesystem init in `server.ts` alongside the existing dirs.
- New file convention: `paths.groups/USER.md` (global user profile). Add `getUserProfilePath()` to `orchestrator/memory.ts`.

**Skill file format** (`SHADE_DATA_DIR/skills/<kebab-name>.md`):
```markdown
---
name: check-plex-health
description: One-line summary used in the skills index shown to the agent
---
<body: the reusable procedure>
```

## APIs

No new REST endpoints (CRUD for messages already exists; memory/skills are filesystem + MCP). All new surface is MCP tools in `backend/src/agentRunner/mcpServer.ts` `buildTools()` (follow the existing `tool(name, description, zodShape, handler)` pattern; register each tool in the returned array so the `mcp__shade-orchestrator` wildcard allowlist picks them up):

| Tool | Input (Zod) | Behavior |
|---|---|---|
| `search_history` | `{query: string, days?: number (default 90), limit?: number}` | `Message.find({$text: {$search: query}, groupId: ctx.groupId, created: {$gte: cutoff}})` sorted by text score, capped at `memory.historySearchLimit`. Returns lines: `[ISO date] sender: <first 300 chars>`. Empty result returns "No matches." |
| `update_memory` | `{scope: "global" \| "group" \| "user", content: string, mode: "replace" \| "append"}` | Writes the corresponding file via `writeMemory()`. Enforce `canWriteGlobalMemory(ctx.isMainGroup)` for `global` and `user`; `group` always allowed for own group. Reject (tool error text, not throw) when resulting file exceeds `memory.maxFileChars`, telling the agent to condense. |
| `save_skill` | `{name: string (kebab-case), description: string, content: string}` | Writes `paths.skills/<name>.md` with frontmatter. Overwrites existing skill of the same name. Rejects over `memory.maxSkillChars`. |
| `list_skills` | `{}` | Returns `name — description` per skill (parse frontmatter only). |
| `load_skill` | `{name: string}` | Returns full skill body, or "Not found" plus the list of valid names. |

`McpContext` already carries group identity for the permission gates (see how `set_allowed_users` and data tools resolve the current group); pass/derive `isMainGroup` from the Group doc (`isMain`).

## Notifications

None.

## UI

None in v1. Memory files are on-disk and skills are inspectable via `list_skills`; admin UI work is future.

## Phases

- **Phase 1 — Config & foundations**: AppConfig fields, `paths.skills`, `getUserProfilePath()`, Message text index.
- **Phase 2 — History search**: `search_history` tool + tests.
- **Phase 3 — Curated memory**: `update_memory` tool (global/group/user scopes) + `USER.md` loaded into the system prompt.
- **Phase 4 — Skills**: `save_skill` / `list_skills` / `load_skill` + skills index in the system prompt.
- **Phase 5 — Prompt wiring**: teach the agent when to use all of it.

## Feature Flags & Migrations

- Flag: `AppConfig.memory.enabled` (default `true`). When `false`: the five tools return "Memory features are disabled", and the prompt block/skills index are omitted from `buildSystemPrompt`.
- Migration: none — text index builds automatically on boot (Message volume is small); memory/skill files are created lazily.

## Activity Log & User Updates

- `logger.info` on every `update_memory` and `save_skill` (scope/name + byte size).
- No user-facing notifications; changes are visible on next agent turn.

## Not Included / Future Work

- Per-group skills; skill versioning/drift detection (a known Hermes weakness — don't inherit it blindly, but don't solve it yet).
- Transcript-file (JSONL session) search; embeddings/semantic search.
- Automatic post-task "should I save a skill?" reflection step (prompt nudge only in v1).
- Admin UI for browsing/editing memory and skills.
- Hermes-style frozen memory snapshots for prompt caching.

## Acceptance Criteria

*Run `/ip:acceptance` for the structured version. Headline checks:*
1. Agent asked "what did we discuss about X last month?" calls `search_history` and answers from results beyond the 2-hour window.
2. From the main group, "remember that I prefer metric units" results in a `USER.md` update visible in the next turn's system prompt; from a non-main group, the `user` scope is rejected.
3. Agent can save a skill, see it in `list_skills` on a later session, and `load_skill` its body.
4. Oversized writes are rejected with a condense instruction, not a crash.
5. With `memory.enabled=false`, tools report disabled and prompts contain no memory/skills block.

---

## Task List

*Each task is a single commit-sized unit. Format: `IP-008: <title>`.*

### Phase 1: Config & Foundations

- [ ] **Task 1.1**: Add `memory` config block
  - Description: Add `memory {enabled, maxFileChars, maxSkillChars, historySearchLimit}` to the AppConfig schema and types.
  - Files: `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
  - Depends on: none
  - Acceptance: `bun run test` passes; config visible via `/app-configs` and editable in admin UI.

- [ ] **Task 1.2**: Add `paths.skills` and `getUserProfilePath()`
  - Description: New lazy path getter (+ test setter, matching existing `paths.*` pattern) in `config.ts`; create dir in `server.ts` filesystem init; `getUserProfilePath()` in `orchestrator/memory.ts` returning `paths.groups/USER.md`.
  - Files: `backend/src/config.ts`, `backend/src/server.ts`, `backend/src/orchestrator/memory.ts`
  - Depends on: none
  - Acceptance: boot creates `data/skills/`; unit test for the path getters.

- [ ] **Task 1.3**: Message text index
  - Description: Add `schema.index({content: "text"})` to the Message model.
  - Files: `backend/src/models/message.ts`
  - Depends on: none
  - Acceptance: index exists after boot (`db.messages.getIndexes()`); a `$text` query returns results in a bun test using an in-memory/dev Mongo.

### Phase 2: History Search

- [ ] **Task 2.1**: `search_history` MCP tool
  - Description: Implement per the APIs table; sort by `{score: {$meta: "textScore"}}`; scope to `ctx.groupId`; format results with Luxon ISO dates.
  - Files: `backend/src/agentRunner/mcpServer.ts` (+ colocated `mcpServer.test.ts` additions)
  - Depends on: 1.1, 1.3
  - Acceptance: unit test seeds messages, calls the tool handler, asserts matches/ordering/limit and the empty-result message.

### Phase 3: Curated Memory

- [ ] **Task 3.1**: `update_memory` MCP tool
  - Description: Implement scopes global/group/user with the existing permission gates, append vs replace, char-cap rejection message.
  - Files: `backend/src/agentRunner/mcpServer.ts`, `backend/src/orchestrator/memory.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: unit tests cover all three scopes, both modes, permission rejection, and cap rejection.

- [ ] **Task 3.2**: Load `USER.md` into the system prompt
  - Description: In `buildSystemPrompt`, read the user profile after SOUL and before global memory; include only when `memory.enabled`.
  - Files: `backend/src/orchestrator/memory.ts`
  - Depends on: 1.2
  - Acceptance: unit test asserts prompt ordering (SOUL → USER → global → group) and omission when flag is off.

### Phase 4: Skills

- [ ] **Task 4.1**: Skill file helpers
  - Description: `saveSkill/listSkills/loadSkill` helpers in a new `backend/src/orchestrator/skills.ts` — frontmatter parse/serialize (simple split on `---`, no new deps), kebab-name validation, char cap.
  - Files: `backend/src/orchestrator/skills.ts`, `backend/src/orchestrator/skills.test.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: round-trip unit tests; invalid names rejected.

- [ ] **Task 4.2**: `save_skill` / `list_skills` / `load_skill` MCP tools
  - Description: Thin tool wrappers over `skills.ts`.
  - Files: `backend/src/agentRunner/mcpServer.ts`
  - Depends on: 4.1
  - Acceptance: unit tests for the three handlers including not-found path.

- [ ] **Task 4.3**: Skills index in the system prompt
  - Description: Append a `## Skills` block to `buildSystemPrompt` listing `name — description` lines plus "Call load_skill before using one" (progressive disclosure — never inline bodies).
  - Files: `backend/src/orchestrator/memory.ts`
  - Depends on: 4.1
  - Acceptance: unit test with 2 seeded skills asserts index lines present, bodies absent.

### Phase 5: Prompt Wiring & Docs

- [ ] **Task 5.1**: Memory prompt block
  - Description: Add a `memoryPromptBlock()` (pattern: `orchestrator/responses/promptBlock.ts`) teaching: search history before saying "I don't know", update USER.md on stable preferences, save a skill after solving a novel multi-step problem; append in `buildSystemPrompt` when enabled.
  - Files: `backend/src/orchestrator/memoryPromptBlock.ts` (new), `backend/src/orchestrator/memory.ts`
  - Depends on: 2.1, 3.1, 4.2
  - Acceptance: prompt contains the block when enabled; unit test.

- [ ] **Task 5.2**: Update architecture docs
  - Description: Update `docs/architecture/agents-and-tools.md` (tool table + memory section) and the assessment doc's gap list.
  - Files: `docs/architecture/agents-and-tools.md`, `docs/architecture/assessment-and-hermes.md`
  - Depends on: 5.1
  - Acceptance: docs match shipped behavior.
