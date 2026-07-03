# PR Review Queue Skill with `prWatch` Handoff

## Summary
Add a new cron-friendly Shade skill that finds pull requests requiring the user's attention, filters out any PRs the user has already replied to, prioritizes the remainder by oldest request-for-attention timestamp, and hands the top results into the existing `prWatch` orchestrator flow.

The skill will support PRs where the configured GitHub user is either an assignee or a requested reviewer. “Already replied” will mean the user has made any of the following on the PR:
- a PR conversation comment
- a submitted review
- a review-thread/code-review comment

The design is intentionally split into triage and handoff:
- **triage** determines which PRs should be processed and in what order
- **handoff** delegates actual processing to the existing `prWatch` path rather than introducing a new auto-fix engine

The skill will be built to run both manually and from cron, using persisted config defaults so scheduled invocation is lightweight and safe.

## Goals / Non-Goals

### Goals
- Add a reusable skill for PR queue triage
- Support PRs where the configured user is:
  - an assignee
  - a requested reviewer
  - or both
- Exclude PRs where the user has already replied via:
  - PR comment
  - submitted review
  - review comment
- Prioritize eligible PRs oldest-first based on the best available request timestamp
- Hand selected PRs into the existing `prWatch` orchestrator
- Support persisted configuration so cron jobs can run with minimal arguments
- Provide dry-run mode for safe verification
- Bound API cost and processing fan-out with configurable limits

### Non-Goals
- Building a native scheduler inside Shade
- Replacing or rewriting `prWatch`
- Introducing new GitHub auto-fix logic outside existing `prWatch` code paths
- Supporting GitHub issues, discussions, or other non-PR objects
- Adding advanced prioritization beyond deterministic timestamp ordering
- Creating broad notification/inbox management features

## Data Model Changes

### New persisted skill configuration
Add persisted configuration for the new PR review queue skill.

Recommended config fields:
- `githubUsername: string`
- `includeAssigned: boolean` default `true`
- `includeRequestedReview: boolean` default `true`
- `requireNoCommentByUser: boolean` default `true`
- `requireNoReviewByUser: boolean` default `true`
- `requireNoReviewCommentByUser: boolean` default `true`
- `orgs: string[]` optional
- `repos: string[]` optional
- `maxCandidatesToInspect: number`
- `maxToProcess: number`
- `dryRun: boolean`
- `oldestFirst: boolean` default `true`
- `fallbackPriorityMode: "reviewRequestThenAssignmentThenCreated"`
- `enabled: boolean`
- `dedupeStrategy: "repo+prNumber" | "nodeId" | "url"`

### Derived runtime work item shape
Define a normalized runtime shape for the triage result before handoff to `prWatch`.

Recommended fields:
- `repoOwner: string`
- `repoName: string`
- `prNumber: number`
- `prUrl: string`
- `title: string`
- `selectionReason: "assigned" | "requested-review" | "both"`
- `priorityTimestamp: string`
- `prioritySource: "review-request" | "assignment" | "created"`
- `hasUserComment: boolean`
- `hasUserReview: boolean`
- `hasUserReviewComment: boolean`
- `dryRun: boolean`

No permanent database schema changes should be required beyond persisted skill config unless existing state tracking patterns require one.

## API / Backend Changes

### 1. Add new skill definition
Create a new skill file:
- `skills/pr-review-queue.md`

The skill should document:
- purpose
- required and optional config
- manual invocation behavior
- dry-run behavior
- cron-oriented usage expectations
- how it hands off to `prWatch`

### 2. Add config load/save path for the skill
Implement a config pattern consistent with existing Shade skills:
- load persisted defaults
- allow runtime overrides if supported by current skill invocation patterns
- validate required fields such as `githubUsername`
- fail closed if `enabled` is false during scheduled runs

### 3. Candidate PR discovery
Use the GitHub integration layer to discover PRs where the configured user is:
- an assignee
- a requested reviewer

Requirements:
- merge both result sets
- deduplicate PRs
- apply optional repo/org filters early if possible
- limit enrichment to `maxCandidatesToInspect`

### 4. Reply detection
For each candidate PR, determine whether the configured user has already replied.

A PR counts as already replied if the user has made any of:
- a PR conversation comment
- a submitted review
- a review-thread/code-review comment

Implementation expectations:
- bot/system comments must not count as user replies
- user identity matching must be explicit and consistent
- if GraphQL/REST coverage differs, choose the path that best supports accurate attribution

### 5. Priority timestamp computation
For each unreplied candidate, compute a single priority timestamp using:
1. review request timestamp, if available
2. assignment timestamp, if available
3. PR created timestamp as fallback

Store both:
- the chosen timestamp
- the source used

If review-request or assignment timestamps require additional timeline/event calls, cap them using `maxCandidatesToInspect`.

### 6. Ranking and selection
Sort eligible PRs:
- oldest first
- deterministic tie-breaker using repo/name + PR number or equivalent stable identifier

Select the top `maxToProcess`.

### 7. Handoff to `prWatch`
Pass each selected PR into the existing `prWatch` orchestrator path using an adapter if needed.

Requirements:
- do not duplicate `prWatch` processing logic
- preserve dry-run mode
- include enough metadata for auditability/logging
- isolate any payload transformation at the boundary

### 8. Cron-safe execution behavior
Support a mode that can be triggered repeatedly by cron without unsafe fan-out.

Requirements:
- respect `enabled`
- respect `maxToProcess`
- emit concise summary logs
- if `prWatch` already has idempotency/state protections, reuse them
- if not, add a lightweight guard at the triage-to-handoff boundary to avoid repeatedly re-triggering the same PRs in a tight loop

## Frontend / UX Changes

### Manual usage experience
Manual runs should return a concise triage summary:
- total candidate PRs found
- number excluded because user already replied
- number eligible after filtering
- top prioritized PRs with reason and age basis
- whether run is dry-run or execute
- number handed off to `prWatch`

### Cron usage experience
Cron-triggered runs should produce terse operational output:
- whether the skill was enabled
- candidates inspected
- eligible PRs found
- top N selected
- whether handoff occurred or was dry-run
- any skipped items due to missing metadata or API failures

### Skill configuration ergonomics
The persisted config should make scheduled setup easy:
- set username once
- set include/exclude filters once
- set caps once
- switch between dry-run and execute
- toggle `enabled` without deleting config

No bespoke UI is required; this is a skill/configuration workflow.

## Phases & Tasks (numbered, each independently testable)

1. **Define skill contract and persisted config**
   - Add `skills/pr-review-queue.md`
   - Define required config and defaults
   - Add config validation and load/save support
   - Test: manual config load succeeds; invalid config fails clearly

2. **Implement candidate PR discovery**
   - Query PRs where user is assignee and/or requested reviewer
   - Merge and deduplicate results
   - Apply repo/org filters
   - Enforce `maxCandidatesToInspect`
   - Test: known fixture/user returns expected candidate set without duplicates

3. **Implement reply detection**
   - Inspect PR comments, submitted reviews, and review comments
   - Attribute activity specifically to the configured user
   - Exclude replied PRs from the queue
   - Test: fixture PRs with each reply type are excluded; PRs with no user activity remain eligible

4. **Implement priority timestamp selection**
   - Compute review-request timestamp when available
   - Fall back to assignment timestamp
   - Fall back to PR created timestamp
   - Persist source metadata for logging/debugging
   - Test: mixed fixtures produce correct timestamp source and sort order

5. **Implement ranking and dry-run summaries**
   - Sort oldest-first
   - Select top `maxToProcess`
   - Emit summary output without handoff in dry-run mode
   - Test: dry-run output matches expected ordered queue and counts

6. **Integrate with `prWatch`**
   - Add adapter from triage result to `prWatch` input contract
   - Preserve dry-run behavior through the handoff path
   - Process top N selected PRs
   - Test: selected PRs enter `prWatch` path successfully without duplicating orchestration logic

7. **Harden cron execution**
   - Respect `enabled`
   - Add concise operational logging
   - Add/confirm idempotency guard if `prWatch` lacks one
   - Test: repeated scheduled runs do not over-process the same PRs and respect configured caps

8. **End-to-end validation**
   - Verify manual run
   - Verify dry-run
   - Verify execute mode
   - Verify cron-oriented invocation path
   - Test: end-to-end workflow finds, ranks, filters, and hands off expected PRs in order

## Risks & Open Questions

### Critical
- **`prWatch` input compatibility**
  - If `prWatch` expects a very specific internal context or trigger source, the adapter may be non-trivial.
  - Mitigation: inspect and document `prWatch`’s actual input boundary before final integration work begins.

### High
- **Accurate review-request timestamp retrieval**
  - GitHub list endpoints may not expose the exact requested-at value needed for correct ordering.
  - Mitigation: use timeline/event enrichment for selected candidates and cap with `maxCandidatesToInspect`.

- **User reply detection across comment types**
  - Conversation comments, submitted reviews, and review comments may come from different endpoints/shapes.
  - Mitigation: normalize user identity matching in one place and test each activity type explicitly.

- **Idempotency under cron**
  - Repeated scheduled runs may keep re-triggering the same PRs if `prWatch` does not mark in-flight or recently-processed items.
  - Mitigation: reuse existing `prWatch` protections if available; otherwise add a lightweight handoff guard.

### Medium
- **Rate limits / API cost**
  - Per-PR enrichment can get expensive across many repositories.
  - Mitigation: apply filters early, cap candidate enrichment, and keep `maxToProcess` small by default.

- **Assignment timestamp availability**
  - Assignment event timestamps may be harder to retrieve than expected.
  - Mitigation: explicitly support fallback ordering and log which priority source was used.

- **Identity ambiguity**
  - GitHub username matching must be aligned with the authenticated actor/configured user.
  - Mitigation: validate config and, where possible, resolve to a canonical user identity before processing.

### Open Questions
- Does `prWatch` already expose a clean callable boundary for a single PR work item, or does it need a thin adapter layer?
- Which existing GitHub API path in the repo is best suited for timeline/event enrichment: REST, GraphQL, or a mix?
- Is there already a reusable “recently processed” state mechanism that cron-triggered skills can use?

## Acceptance Criteria (manual + automated)

### Manual acceptance criteria
- A persisted config can be created for the new skill with username, caps, filters, and dry-run/execute settings.
- A manual dry-run lists PRs where the user is assignee and/or requested reviewer.
- PRs where the user has already left a comment, review, or review comment are excluded.
- Remaining PRs are ordered oldest-first by:
  - review request timestamp when available
  - otherwise assignment timestamp
  - otherwise PR created timestamp
- The output clearly shows:
  - candidate count
  - excluded/replied count
  - eligible count
  - selected top N
  - dry-run vs execute mode
- In execute mode, the selected PRs are handed into `prWatch` rather than a separate processing path.
- A scheduled/cron-triggered run works using persisted defaults without requiring all arguments each time.
- Disabled config prevents cron execution cleanly.

### Automated acceptance criteria
- Unit/integration tests cover candidate discovery for:
  - assignee only
  - requested reviewer only
  - both with deduplication
- Tests cover reply detection for:
  - PR conversation comment by configured user
  - submitted review by configured user
  - review comment by configured user
  - activity by other users not causing exclusion
- Tests cover priority source selection:
  - review request timestamp preferred
  - assignment timestamp fallback
  - created timestamp fallback
- Tests verify deterministic oldest-first ordering.
- Tests verify `maxCandidatesToInspect` and `maxToProcess` caps are respected.
- Tests verify dry-run does not invoke `prWatch`.
- Tests verify execute mode invokes `prWatch` with the expected normalized work item shape.
- Tests verify disabled cron config skips execution.
- Tests verify repeated scheduled runs do not create uncontrolled duplicate processing when idempotency protections are present.