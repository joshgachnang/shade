# Implementation Plan Index

Tracked implementation plans for shade.

See `CLAUDE.md` for IP lifecycle stages and management guidelines.

## Active Plans

| IP | Title | Status | Effort | Priority |
|----|-------|--------|--------|----------|
| IP-013 | [Console Real Data](Console-Real-Data.md) | Open | Big batch (3-5 days) | High |
| IP-001 | Shade Orchestrator | In Progress | Epic (2+ weeks) | High |
| IP-002 | Shade Claude Fleet | Open | Epic (2+ weeks) | High |
| IP-003 | Email IMAP Channel Connector | In Progress | Small batch (1-2 days) | High |
| IP-004 | Movie Scene Analyzer | Pending Verification | Big batch (1-2 weeks) | High |
| IP-005 | Rich Response UI | Open | Big batch (1-2 weeks) | High |
| IP-006 | Edge Agents | Pending Verification | Big batch (1-2 weeks) | High |
| IP-007 | Trivia Group | Open | Small batch (1-2 days) | Medium |
| IP-008 | Agent Memory & Learning | Pending Verification | Big batch (1-2 weeks) | High |
| IP-009 | Agent Task Board & Worker Pool | Pending Verification | Big batch (1-2 weeks) | High |
| IP-010 | Gateway/Worker Process Split | Pending Verification | Big batch (1-2 weeks) | Medium |
| IP-011 | Channel & Scheduler Polish | Pending Verification | Small batch (1-2 days) | Medium |

**Suggested implementation order for IP-008–011** (from `docs/architecture/assessment-and-hermes.md`): IP-011 and IP-008 first in either order (both independent; IP-011 is a small warm-up, IP-008 is highest leverage), then IP-009, then IP-010 (hard dependency on IP-009). IP-008's and IP-009's prompt-block tasks touch `orchestrator/memory.ts` — whichever lands second rebases trivially.

## Completed

| IP | Title | Completed | Notes |
|----|-------|-----------|-------|
| IP-012 | AI Testability Harness | 2026-07-04 | PRs #84/#86. `SHADE_TEST_MODE=1` offline harness: MockAgentRunner + LlmFixture, "test" channel type, /test/* control API, sensitive-integration guards. Docs: `docs/testing/ai-harness.md`. Options B (fake Anthropic wire API) and C (real-Haiku smoke tier) deferred as future work. |

## Deferred / Closed

| IP | Title | Status | Notes |
|----|-------|--------|-------|
| - | - | - | No deferred plans yet |

## Backlog

Low-priority or blocked items. Promote to Active when ready to plan.

| IP | Title | Notes |
|----|-------|-------|
| - | - | No backlog items yet |
