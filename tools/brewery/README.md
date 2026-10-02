# brewery

Plan and ship a feature with a separate agent process for every step. It uses the
`distill`, `cut`, `barrel`, and `finish` skills in this repo's `.claude/skills/` for method. brewery
owns sequencing, commits, CI waits, limits, and every contact with the human.

```text
brewery distill "<request>"      claude writes the IP ─┐
                                  cut: claude + codex attack it (clean worktree, only your words)
                                  claude fixes the findings (≤2 rounds)
                                  → sign-off message, ntfy ping, exit 3
brewery answer <slug> "ok, 2b"   apply the reply → Status: approved
brewery barrel <slug>            per task: create worktree → setup → codex picks → commit → claude roasts
                                    (FAIL → pick again with evidence, amend the worktree commit)
                                    PASS → cherry-pick onto feature branch → tick checkbox and amend → remove worktree
                                  branch review: claude + codex in parallel → fix blocking findings
                                  brew: claude opens the PR
                                  finish: gh waits (no tokens) → claude tastes each red snapshot
                                  → PR conflict-free and green, exit 0
```

## Install

```bash
cd tools/brewery && bun install
ln -sf "$PWD/src/cli.ts" ~/bin/brewery   # or: bun run compile
brewery agents                                            # what is available, how stages route
```

## Agents and routing

Profiles are `claude` (`claude -p`), `codex` (`codex exec`), or `command` (any argv, with
the prompt on stdin). Local models run through codex with a custom provider pointed at
the litellm gateway, so they get a real tool-using harness:

```json
{
  "agents": {
    "local": {
      "type": "codex",
      "model": "deepseek-v4",
      "provider": { "name": "litellm", "baseUrl": "http://100.76.70.90:4000/v1", "envKey": "LITELLM_API_KEY" }
    },
    "opus": { "type": "claude", "model": "opus" }
  },
  "stages": { "pick": ["codex"], "roast": ["claude", "local"], "cut": ["claude", "codex", "local"] },
  "notify": { "ntfyUrl": "https://ntfy.sh/<topic>" },
  "worktreeSetup": ["bun bootstrap"],
  "limits": { "pickAttempts": 3, "parallelTasks": 3, "finishPushes": 6, "finishHours": 4 }
}
```

Put it in `~/.config/brewery/config.json`, or `<repo>/.brewery.json` per repo. Override a
single run with `--agents pick=claude,roast=claude+codex`.

Each task builds sequentially in `.terreno/brewery/<slug>/worktrees/<id>` on local branch
`brewery/<slug>/<id>`, starting from the feature branch's current head. Pick and Roast
read the IP and repository skills in that worktree. Step logs and run state remain in
the main tree. After Roast passes, brewery cherry-picks the task commit, checks its IP
box inside that landed commit, records the landed SHA, and removes the worktree and
local branch. Retries after Roast failures amend the same worktree commit. Gated tasks
retain their worktree and commit for a later retry; skipping a task removes that tree.

| Config | Default | Behavior |
| --- | --- | --- |
| `worktreeSetup` | `[]` | Shell commands run in order in each fresh task worktree, before Pick. Shade uses `["bun bootstrap"]`. A nonzero exit records stdout/stderr as failure evidence, removes the tree, and consumes a Pick attempt. |
| `limits.parallelTasks` | `3` | Reserved concurrency limit; task builds currently remain sequential. |

`cut`, `roast`, and `review` fan out. Every listed agent runs, and a FAIL from any one of
them fails the step. Other stages use the first available agent. An unavailable agent
(missing binary, unset key) is skipped with a note.

## What is enforced, and how

| Rule | Mechanism |
| --- | --- |
| Separate agents per step | Every step is a new `claude -p` / `codex exec` process with a written prompt. |
| Cut sees only the human's words | Its prompt holds only `.terreno/brewery/<slug>/context.md` (your request and replies, verbatim), and it runs in a `git worktree` of HEAD where `.terreno/` does not exist. |
| Roast judges a fixed tree | brewery commits after Pick, before Roast. Retries amend the task's commit. |
| No self-approval | brewery owns the IP's `Status:` line and resets one an agent approved. Only `brewery answer` approves. |
| Progress can't be faked | brewery checks each task box only after a Roast PASS and cherry-pick onto the feature branch. |
| Bounded loops | Pick attempts per task, cut and review rounds, finish pushes and hours, and a "same failure twice" stop. |
| No tokens while waiting | brewery runs `gh pr checks --watch` itself and starts a Taste agent only on a red snapshot. |
| Privacy | ntfy pings carry no content. The full message prints to the terminal and is saved in state. |

## Human loop

When a run needs you, brewery prints one message (and an SMS-length version), pings ntfy,
saves the state, and exits with code 3. When you are at the terminal, it asks for the
reply right there instead. Reply from anywhere with `brewery answer <slug> "<reply>"`:

- sign-off: `ok`, `ok, 2b`, `no: <why>`, or answers without approval (applied, then asked again)
- gates: `1a`, `retry: <hint>`, `skip` (task), `ship` (review), `stop`

`brewery status` lists runs and what is waiting on you. Each step's prompt, log, and result
are in `.terreno/brewery/<slug>/steps/`.

## Development

```bash
bun test          # unit + end-to-end flows against temp repos with a scripted fake agent
bun run typecheck
```
