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
brewery barrel <slug>            per task: codex picks → brewery commits → claude roasts
                                    (FAIL → pick again with evidence, amend the commit)
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
  "limits": { "pickAttempts": 3, "finishPushes": 6, "finishHours": 4 }
}
```

Put it in `~/.config/brewery/config.json`, or `<repo>/.brewery.json` per repo. Override a
single run with `--agents pick=claude,roast=claude+codex`.

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
| Progress can't be faked | brewery checks each task box only after a Roast PASS. |
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

## Progress events

Each run appends one JSON object per line to `.terreno/brewery/<slug>/events.jsonl`.
Consumers can keep a byte offset and read only new lines. Every event has an ISO 8601
`t` timestamp and a `kind` field. The file stays outside git with the rest of the run
state.

| Kind | Fields | When emitted |
| --- | --- | --- |
| `step.start` | `seq`, `stage`, optional `task`, `agent` | Before an agent process starts |
| `step.end` | `seq`, `status`, `action`, `seconds` | After its result is read, including failed results |
| `narration` | `seq`, `text` | As Claude or Codex emits assistant text or starts a tool; one line, at most 300 characters |
| `waiting` | `waitingKind` (`signoff` or `gate`), `message`, optional `ip` | When brewery stops for a human answer |
| `resumed` | — | When brewery accepts an answer to a waiting run |
| `note` | `text` | When a human answer is recorded |
| `pr` | `number`, `url` | When brewery finds the run's PR |
| `ci` | `state` (`pending`, `fail`, or `pass`) | After each CI snapshot |
| `done` | — | When the PR is green and the run finishes |
| `error` | `message` | When a run command exits with an error |

For example, `{"t":"2026-09-28T12:00:00.000Z","kind":"step.start","seq":1,"stage":"distill","agent":"claude"}`
starts a step. Match its `seq` to the later `step.end`. Fan-out steps have a separate
sequence number per agent.

Claude runs with `--output-format stream-json --verbose`; Codex runs with `exec --json`.
The raw JSONL output remains in each step's `.log` file. Brewery reads complete stdout
lines as they arrive and appends `narration` events for assistant text and brief tool
summaries, such as `Read groupQueue.ts` or `Bash: bun test`. It ignores malformed lines,
tool output, and final result records. `command` profiles emit only step start and end.

## Development

```bash
bun test          # unit + end-to-end flows against temp repos with a scripted fake agent
bun run typecheck
```
