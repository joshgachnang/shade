---
name: ip:review
description: "Dual-model IP review — Claude and Codex review an implementation plan in parallel, surface issues, generate questions, and update the plan"
disable-model-invocation: true
---

# IP Review: Dual-Model Implementation Plan Review

Review an implementation plan using both Claude (sub-agent) and OpenAI Codex in parallel. Each reviewer independently identifies issues, gaps, and questions. Results are combined, deduplicated, and presented as a structured question list for the user. After the user answers, the IP is updated.

## Argument

IP number, filename, or path to the plan file. If empty, infer from conversation context.

Parse the argument: `$ARGUMENTS`

## Phase 1: Locate the Plan

1. If argument provided, find the matching IP file:
   - Check `docs/implementationPlans/` for matching file (by IP number, slug, or full path)
   - If a path was given directly, use that
2. If no argument, infer from conversation context (most recently discussed IP)
3. If ambiguous, ask the user
4. Read the full plan file
5. If a corresponding task file exists in `docs/tasks/`, read that too

## Phase 2: Gather Codebase Context

Collect context both reviewers will need:

1. **CLAUDE.md** -- project conventions, tech stack, constraints
2. **Relevant source files** -- scan the plan's "Files to Create/Modify" or "Files:" fields in tasks, read 3-5 of the most critical existing files
3. **Data models** -- if the plan references models, find and read their current definitions
4. **Recent changes** -- `git log --oneline -10` for recent momentum

Keep context focused. Prioritize the plan itself and the most relevant code.

## Phase 3: Run Both Reviews in Parallel

Launch both reviewers at the same time using parallel tool calls. Do NOT wait for one before starting the other.

### 3a: Claude Sub-Agent

Use the **Agent tool** with `subagent_type: "general-purpose"`:

Prompt the sub-agent with all gathered context and these instructions:

> You are a senior engineer reviewing an implementation plan. Your goal is to surface issues, gaps, risks, and questions that should be answered before implementation begins.
>
> ## The Plan
>
> {full plan content}
>
> ## Task Breakdown
>
> {task list content, if available}
>
> ## Codebase Context
>
> {CLAUDE.md excerpt -- tech stack, conventions}
>
> {relevant source file excerpts}
>
> ## Your Review
>
> Analyze this plan and produce two outputs:
>
> ### Issues & Gaps
>
> For each issue found, provide:
> - **Severity**: CRITICAL / HIGH / MEDIUM / LOW
> - **Category**: one of: Missing Requirements, Unstated Assumptions, Technical Risks, Security & Data Integrity, Task Breakdown Gaps, Architecture Concerns, Scope Concerns
> - **Description**: What's wrong or missing -- be specific, cite the plan section
> - **Suggestion**: How to address it
>
> ### Questions for the Author
>
> Generate questions that, if answered, would materially improve the plan. Focus on:
> - Ambiguous requirements that could be interpreted multiple ways
> - Unstated preferences (e.g., "should this be real-time or batch?")
> - Tradeoffs where the plan picked one side without discussing alternatives
> - Missing context that would change the approach
> - Scale/performance expectations that aren't specified
> - Integration points with unclear contracts
> - Rollback/migration strategies that aren't defined
>
> For each question:
> - **Question**: The question itself
> - **Why it matters**: What changes depending on the answer
> - **Default assumption**: What the plan currently assumes (if anything)
>
> Do NOT ask questions that can be answered by reading the codebase -- use Glob, Grep, and Read to verify before asking. Only ask questions that require human judgment or domain knowledge.

### 3b: Codex CLI

Build a prompt file at `$TMPDIR/ip-review-prompt.md` with the plan, tasks, and codebase context, then run:

```bash
codex --model o3 --quiet --approval-mode full-auto "$TMPDIR/ip-review-prompt.md"
```

The prompt file should contain:

```markdown
# Implementation Plan Review: {plan title}

You are a senior engineer reviewing an implementation plan. Find issues, gaps, and generate questions for the plan author.

## The Plan

{full plan content}

## Task Breakdown

{task list content, if available}

## Codebase Context

{CLAUDE.md excerpt}

{relevant source file excerpts}

## Your Review

### Part 1: Issues & Gaps

For each issue, provide:
- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **Category**: Missing Requirements, Unstated Assumptions, Technical Risks, Security & Data Integrity, Task Breakdown Gaps, Architecture Concerns, or Scope Concerns
- **Description**: Be specific -- cite the plan section and explain exactly what's wrong or missing
- **Suggestion**: How to fix it

### Part 2: Questions for the Author

Generate questions that require human judgment or domain knowledge to answer. For each:
- **Question**: The question
- **Why it matters**: What would change depending on the answer
- **Default assumption**: What the plan currently assumes

Focus on: ambiguous requirements, unstated tradeoffs, missing scale/performance expectations, unclear integration contracts, and migration/rollback gaps.

Do NOT ask questions answerable from the codebase. Focus on decisions that need human input.
```

**Model selection:** Use `o3` for strong reasoning. If unavailable, fall back to `o4-mini`.

If `codex` is not installed or fails, report the error and continue with Claude-only results.

Capture the full output.

## Phase 4: Combine & Deduplicate

After both reviews return:

### Issues

1. Parse all issues from both reviewers
2. Deduplicate: if both flagged the same issue (same plan section, similar concern), merge and keep the more detailed description
3. Tag each with its source:
   - `[Claude]` -- only Claude found it
   - `[Codex]` -- only Codex found it
   - `[Both]` -- both flagged it (higher confidence)
4. Sort by severity: CRITICAL > HIGH > MEDIUM > LOW

### Questions

1. Parse all questions from both reviewers
2. Deduplicate: merge questions asking essentially the same thing
3. Tag with source (`[Claude]`, `[Codex]`, `[Both]`)
4. Group by theme (e.g., "Scope", "Architecture", "Data", "Performance", "Migration")
5. Within each group, sort by impact (questions where the answer would most change the plan come first)

### Verify Critical Claims

For CRITICAL and HIGH issues, do a quick Glob/Grep/Read to confirm the issue is real. Note which are verified vs unverified.

## Phase 5: Present Results

Present the combined review:

```
## IP Review: {plan title}

**Reviewers:** Claude (sub-agent) + OpenAI Codex ({model used})
**Plan:** {IP file path}

---

### Issues Found

#### Critical
1. [Both] **{category}** -- {description}
   → {suggestion}

#### High
2. [Claude] **{category}** -- {description}
   → {suggestion}

#### Medium / Low
3. [Codex] **{category}** -- {description}
   → {suggestion}

---

### Questions for You

**Scope & Requirements**
1. [Both] {question}
   _Why it matters:_ {impact}
   _Current assumption:_ {what plan assumes}

**Architecture & Design**
2. [Claude] {question}
   _Why it matters:_ {impact}
   _Current assumption:_ {what plan assumes}

**Performance & Scale**
3. [Codex] {question}
   _Why it matters:_ {impact}

{...more grouped questions...}
```

## Phase 6: Collect Answers

Use **AskUserQuestion** to collect the user's answers. Present the questions in a numbered list and ask the user to answer them. Options:

- Answer all at once (numbered responses)
- Answer one at a time interactively
- Skip questions they don't want to address yet (mark as "deferred")

For skipped questions, note the current assumption the plan makes and flag it as an unresolved decision.

## Phase 7: Update the Plan

After collecting answers:

1. **Read the current IP file** fresh (in case it changed)
2. **For each answered question**, determine what section(s) of the plan need updating
3. **For each confirmed issue**, draft the fix
4. **Draft all changes** and present them to the user as a before/after diff for each section
5. Ask: "Apply these updates to the plan?"
6. If yes, edit the IP file with all changes
7. If a task file exists, update it too if any tasks are affected
8. Add an "## Review Log" entry at the bottom of the IP file:

```markdown
## Review Log

### {today's date} -- Dual-Model Review
- **Reviewers:** Claude + Codex ({model})
- **Issues found:** {N} ({breakdown by severity})
- **Questions asked:** {N} ({answered}/{deferred})
- **Plan updated:** Yes/No
- **Unresolved:** {list any deferred questions or unverified issues}
```

## Cleanup

```bash
rm -f "$TMPDIR/ip-review-prompt.md"
```

## Notes

- The value is **dual perspective** -- Claude and Codex have different biases and catch different things
- Questions tagged `[Both]` deserve the most attention -- two independent models flagged the same gap
- Don't pre-filter findings. Present honestly even if they contradict earlier Claude work on the plan
- This command fits between `/ip:generate` and implementation -- use it as a quality gate
- Can also be run mid-implementation to reassess the plan as understanding deepens
