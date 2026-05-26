---
name: ip:status
description: "Implementation Plan Status — show active IPs with status and grooming"
disable-model-invocation: true
---

# Implementation Plan Status

Generate an up-to-date summary of active implementation plans.

## Fast Path vs Full Grooming

**Decide which path to take based on conversation context:**

### Fast Path (just print the table)
Use this when you are **confident the index is up to date** -- for example:
- You've been working on IPs in this session (closing, creating, updating)
- You just ran a full grooming pass recently
- The user just asked you to "print the status"

Simply read `docs/implementationPlans/PLAN_INDEX.md` and each active IP file, then output the table.

### Full Grooming (first invocation or uncertain state)
Use this when you have **no context about the current state**:
- Start of a new conversation
- You haven't touched any IPs yet
- The user explicitly asks for a grooming check

Perform these housekeeping checks:

#### 1. Status Sync Check
- Read each active IP file and compare its `**Status:**` line to the index
- If discrepancy, update the index to match the file (file is source of truth)
- Report any discrepancies found and fixed

#### 2. Archive Check
- Look for IP files in `docs/implementationPlans/` (not in `archive/`) with status: Complete, Deferred, or Closed
- For each such IP not yet archived:
  - Move to `docs/implementationPlans/archive/`
  - Ensure it's in the appropriate section of the index
- Report any files archived

#### 3. Orphan Check
- Check if any IPs in the index don't have corresponding files
- Check if any IP files exist that aren't in the index (exclude IP_TEMPLATE.md and PLAN_INDEX.md)
- Report any orphans found

#### 4. Task Progress Check
- For each active IP, check if a corresponding task file exists in `docs/tasks/`
- Count completed vs total tasks (checked vs unchecked checkboxes)
- Include task progress in the output table

## Output

Format the output as a markdown table:

    ## Active Implementation Plans

    | IP | Title | Status | Effort | Tasks | Description |
    |----|-------|--------|--------|-------|-------------|
    | IP-XXX | Title here | Status | Effort | 3/10 | Brief description |

    **Total:** X active plans (Y design, Z open, W in progress)

If full grooming was performed and changes were made, prepend a grooming report.

## Notes

- Keep descriptions concise (< 60 chars if possible)
- Include a count summary at the bottom
- Task column shows completed/total if task file exists, "-" otherwise
