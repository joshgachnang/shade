---
name: pour
description: Commit, push, and set up the PR, then hand off to the dialin skill (.claude/skills/dialin/SKILL.md). Use ONLY when code is ready to enter review — not for implementation work, independent verification, or waiting on CI/comments after the PR is open.
---

# Pour

Get work into review, then immediately hand ownership to **Dial In**.

## Scope Boundary

Pour owns only pre-review-open and review-open actions:

1. Final pre-submit checks.
2. Commit and push.
3. Create/update draft PR.
4. Resolve merge conflicts required to get PR updated.
5. Ensure CI is triggered on the first push.
6. Immediately hand off to Dial In (`.claude/skills/dialin/SKILL.md`).

Pour must never block on CI completion or review comments.

## Procedure

### 1) Pre-submit checks

Run required checks for touched areas (lint/compile + targeted tests).
Stop and fix before committing if checks fail.

### 2) Commit hygiene

- Review `git status`/`git diff`.
- Stage only relevant files.
- Commit with clear message.
- No AI attribution/co-author text, no conventional-commit prefixes.

### 3) Push branch

- Push with upstream.
- On network errors, retry with exponential backoff (4s, 8s, 16s, 32s).

### 4) PR setup

- Reuse existing PR if present; otherwise create draft PR.
- Read and apply PR template if present.
- Keep PR title/body accurate and concise.
- Include human testing steps and automated checks sections.
- **Include run evidence:** if any screenshots, screen recordings, or videos were captured during this run (browser testing, Playwright, UI verification), add them to the PR body under an `## Evidence` section with a one-line caption per item. When updating an existing PR, append new evidence without removing what is already there. Skip the section if no evidence exists.

### 5) Conflict resolution before handoff

If push/rebase/merge conflicts block PR update:

- Resolve conflicts.
- Re-run required checks.
- Commit and push conflict fix.

### 6) Handoff (required)

As soon as the PR is open/updated and CI has been triggered on the first push:

1. Read `.claude/skills/dialin/SKILL.md`.
2. Execute the **Dial In** procedure immediately — same turn if possible — without waiting for CI to finish.
3. Exit pour's scope without blocking; Dial In owns the reactive loop from here.

## Branch/Repo Conventions

- Kebab-case branch names (e.g. `fix-login-bug`).
- Keep commit/PR text free of AI attribution.
