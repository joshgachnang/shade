# Agent Memory & Learning (IP-008) — Task List

Source: [Agent-Memory-And-Learning.md](../implementationPlans/Agent-Memory-And-Learning.md)

## Phase 1: Config & Foundations

- [ ] **1.1** Add `memory` AppConfig block (enabled, maxFileChars, maxSkillChars, historySearchLimit)
- [ ] **1.2** Add `paths.skills` getter + `getUserProfilePath()`; create skills dir on boot
- [ ] **1.3** Message text index (`{content: "text"}`)

## Phase 2: History Search

- [ ] **2.1** `search_history` MCP tool (group-scoped $text search, date cutoff, formatted snippets)

## Phase 3: Curated Memory

- [ ] **3.1** `update_memory` MCP tool (global/group/user scopes, append/replace, char caps, permission gates)
- [ ] **3.2** Load `USER.md` into `buildSystemPrompt` (SOUL → USER → global → group order)

## Phase 4: Skills

- [ ] **4.1** Skill file helpers (`orchestrator/skills.ts`: frontmatter, kebab validation, caps)
- [ ] **4.2** `save_skill` / `list_skills` / `load_skill` MCP tools
- [ ] **4.3** Skills index (names + descriptions only) in system prompt

## Phase 5: Prompt Wiring & Docs

- [ ] **5.1** Memory prompt block (when to search/update/save-skill)
- [ ] **5.2** Update `docs/architecture/` docs
