---
name: ip:close
description: "Close / Complete an Implementation Plan — mark complete, archive, update index"
disable-model-invocation: true
---

# Close / Complete an Implementation Plan

Close an IP by marking it complete (or closed/deferred), archiving the file, and updating the index.

## Argument

The argument should contain:
- **IP number or name** (required-ish): e.g. `1`, `IP-001`, or the plan filename slug
- **Disposition** (optional): `complete` (default), `closed`, or `deferred`
- **Notes** (optional): any additional context

Examples:
- `/ip:close 1` -- mark IP-001 as Complete
- `/ip:close user-permissions deferred blocked on auth refactor` -- mark by name, Deferred
- `/ip:close 3 closed superseded by IP-005` -- mark IP-003 as Closed
- `/ip:close` (no args) -- infer from conversation context

Parse the argument: `$ARGUMENTS`

## Inferring the IP

If no IP number/name provided, infer from conversation context:
- Look at which IP was most recently discussed or worked on
- If exactly one IP is obvious, use it and state which one
- If ambiguous, ask the user

## Steps

### 1. Find and read the IP file

- Search `docs/implementationPlans/` for matching file (by IP number, Title-Case filename, or slug)
- Read to get title, current status
- If already archived or not found, report and stop

### 2. Update the IP file

- Set `**Status:**` to `Complete`, `Closed`, or `Deferred`
- For Complete: add `**Completed:** {today YYYY-MM-DD}` after Status
- For Closed/Deferred: add `**Closed:** {today}` if not present

### 3. Update PLAN_INDEX.md

- Read `docs/implementationPlans/PLAN_INDEX.md`
- Remove IP's row from **Active Plans** table
- Add to appropriate section:
  - **Complete** -> add to top of `## Completed` table with date and notes
  - **Closed/Deferred** -> add to top of `## Deferred / Closed` table with status and notes

### 4. Archive the files

- Move IP file to `docs/implementationPlans/archive/`
- If a corresponding task file exists in `docs/tasks/`, move it to `docs/implementationPlans/archive/` as well (or leave in place if tasks are still referenced)

### 5. Commit

Commit all changes in a single atomic commit:
- Check `git status` for uncommitted changes related to the IP implementation
- Stage implementation files, archived IP, deleted original path, `PLAN_INDEX.md`
- Commit with message: `IP-{number}: {title}`

### 6. Summary

Report:
- IP number and title
- Disposition (Complete / Closed / Deferred)
- Status updated in IP file
- Moved from Active to the appropriate section in index
- Archived to `docs/implementationPlans/archive/`
- Committed: {short hash}
