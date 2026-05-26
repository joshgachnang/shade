---
name: ip:ingest
description: "IP Step 1: Ingest PRD — collect the PRD that will drive the implementation plan"
disable-model-invocation: true
---

# IP Step 1: Ingest PRD

Collect the PRD (Product Requirements Document) that will drive the implementation plan.

## Instructions

1. `$PRD` is **required**. If it was not provided, stop immediately and tell the user: **"Error: /ip requires a PRD as the first argument (either a file path or the inline PRD text). Please re-run as `/ip <path-or-text>`."** Do not prompt for it interactively.

2. Determine what the user provided:
   - If it looks like a file path (e.g., ends in `.md`, `.txt`, contains `/` or `\`, or matches an existing file), read that file and use its contents as the PRD.
   - Otherwise, treat the input as the PRD text itself.

4. The PRD should contain at minimum a **Problem** section and ideally a **Business Case** section. If either is missing, note what's missing but proceed anyway.

5. Display a brief summary of what you understood from the PRD:
   - The core problem (1-2 sentences)
   - The business impact (1-2 sentences)
   - Key stakeholders or affected teams
   - Any constraints or requirements called out

6. Ask: "Does this summary capture the intent? Anything to add or correct?" and let the user adjust before moving on.

7. Once confirmed, say: **"PRD ingested. Moving to research phase..."** and proceed to run `/ip:research`.

## Arguments

$PRD: Optional path to a PRD markdown file
