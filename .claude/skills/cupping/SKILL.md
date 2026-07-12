---
name: cupping
description: Independently verify a completed implementation against the IP/spec with concrete evidence. Use ONLY when implementation already exists — not for writing feature code, planning the IP, or running the PR submission/review loop.
---

# Cupping

Independent verification of completed implementation against IP/spec, runnable even when the verifier did not author the PR.

## Verification Objective

- Prove or disprove that implementation matches intended scope and acceptance expectations.
- Produce concrete evidence (commands run, outputs, screenshots/videos when UI is involved).

## Standalone Entry

Cupping can run on:

- Local branch changes, or
- An existing PR owned by someone else (resolve PR, check out in a dedicated worktree, run `bun bootstrap` to set up the environment).

## Verification Workflow

1. Load source of truth (IP/spec, acceptance criteria, PR context).
2. Build a requirement-to-evidence checklist.
3. Run targeted automated checks for touched packages.
4. Run manual verification where automation is insufficient.
5. Record pass/fail per requirement with evidence.

## UI Verification Requirements

For UI-facing changes, include manual verification and visible artifacts:

- Start the backend (`cd backend && bun run dev`) and web frontend (`cd frontend && bun run web`).
- Verify flows in the browser (or run the relevant Playwright specs in `e2e/`).
- Use known test accounts when needed.
- Capture screenshots/video evidence.

## Evidence Rules

- Save artifacts under `test-results/` (gitignored) or the session scratchpad.
- Include command outputs and media references needed for reviewer confidence.
- Report mismatches explicitly; do not mask failures.

## Output Structure

- Scope verified.
- Checks executed.
- Requirement-by-requirement outcome.
- Evidence references.
- Open defects/gaps (if any) with severity.
