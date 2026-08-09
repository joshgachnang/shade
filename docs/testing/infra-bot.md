# Testing the Infra Bot

The Infra Bot lets the agent propose changes to git-backed infrastructure repos on
feature branches and open a PR — but never merge or deploy. This doc lays out how to
verify it at three levels: deterministic unit/integration tests, a fully-offline live
agent loop (Claude actually drives Shade, real git, zero network), and a real
end-to-end run against GitHub.

The guardrails under test:

- **Allowlist = blast radius** — only `AppConfig.infraBot.repos` can be touched.
- **Never the deploy branch** — changes go on `branchPrefix`-prefixed feature branches;
  pushing the deploy branch is refused.
- **AI behind PR review** — there is no merge/deploy tool. The bot opens a PR and stops.
- **Feedback loop** — the `InfraWatcher` reports review/CI/merge back to the group.

---

## Level 1 — Deterministic tests ($0, no network, no LLM)

These cover the git guardrails, the four MCP tools, and the watcher against a **local
bare repo** and a **fake GitHub client** — no credentials, no network.

```bash
cd backend
bun test src/utils/infraGit.test.ts \
         src/agentRunner/infraTools.test.ts \
         src/orchestrator/services/infraWatcher.test.ts
```

What they prove:

| Test file | Proves |
|---|---|
| `infraGit.test.ts` | allowlist rejects unknown repos; deploy branch / missing-prefix pushes are refused; clone → worktree → commit → push works and **the deploy branch SHA never moves**; two concurrent worktrees on one repo don't clobber each other |
| `infraTools.test.ts` | tools are gated off when disabled / wrong group; `prepare_infra_change` refuses off-allowlist repos; `prepare` → edit → `submit` really pushes a branch |
| `infraWatcher.test.ts` | merge/close/review-CI transitions are detected and announced once; unchanged state stays quiet |

---

## Level 2 — Live agent loop, fully offline (Claude drives Shade)

Here the **real** agent (DirectAgentRunner) calls the infra MCP tools end to end, but
you point the managed repo at a **local bare git repo** and leave the GitHub token
empty — so it runs real git with **no network and no GitHub**. `submit_infra_change`
pushes the branch to the local bare repo and returns the "no token — open the PR
manually" path.

> Note: `SHADE_TEST_MODE=1` uses the *mock* runner, which only replays scripted fixture
> actions and never invokes MCP tools. To exercise the real tool path you need a real
> Anthropic key (dev mode). Keep it offline by using a local bare repo + empty token.

**1. Make a local "managed" repo to act as the git server:**

```bash
TMP=$(mktemp -d)
git init --bare --initial-branch=main "$TMP/stacks.git"
git init --initial-branch=main "$TMP/seed" && cd "$TMP/seed"
git config user.email a@b.c && git config user.name seed
printf 'services: {}\n' > compose.yml
git add -A && git commit -m init && git remote add origin "$TMP/stacks.git" && git push -u origin main
echo "gitUrl = $TMP/stacks.git"
```

**2. Configure `AppConfig.infraBot`** (via the admin UI, or edit the AppConfig doc).
Leave `apiKeys.github` empty. Set `groupId` to the group you'll message:

```jsonc
"infraBot": {
  "enabled": true,
  "groupId": "<your group _id>",
  "reposBaseDir": "data/infra-repos",
  "branchPrefix": "infra-bot/",
  "repos": [{
    "name": "stacks",
    "gitUrl": "/tmp/…/stacks.git",   // the bare repo from step 1
    "owner": "", "repo": "",          // empty → submit returns the manual-PR path
    "deployBranch": "main",
    "description": "Docker compose stacks"
  }]
}
```

**3. Boot Shade with a real Anthropic key and drive it via `/command`:**

```bash
cd backend && bun run dev           # needs AppConfig.apiKeys.anthropic set

TOKEN=$(curl -s -X POST localhost:4020/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<admin>","password":"<pw>"}' | jq -r .data.token)
AUTH="Authorization: Bearer $TOKEN"

# Message the group exactly as if it came from Slack:
curl -s -X POST localhost:4020/command -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"groupId":"<your group _id>","content":"@Shade add a redis service to the stacks repo and open a PR"}'
```

**4. Observe that the tools fired and a branch was produced:**

```bash
# The agent's tool calls + result:
curl -s "localhost:4020/taskRunLogs?groupId=<id>" -H "$AUTH" | jq '.data[0]'
# Session transcript (shows list_infra_repos / prepare_infra_change / submit_infra_change):
ls backend/data/sessions/<groupId>/

# The branch the bot pushed to the "git server":
git -C "$TMP/stacks.git" branch --list 'infra-bot/*'
git -C "$TMP/stacks.git" log --oneline -1 "infra-bot/<branch>"
# The deploy branch is untouched:
git -C "$TMP/stacks.git" rev-parse main   # unchanged from step 1
```

**Expected:** a new `infra-bot/…` branch exists in the bare repo with the agent's edit,
`main` is unchanged, and the agent's final reply says it pushed the branch and that a
human must open/merge the PR. This is the whole "AI behind PR review" contract, verified
without any external service.

---

## Level 3 — Real GitHub end to end (PR + watcher)

Same as Level 2 but with a real repo, so you get an actual PR and the watcher fires:

1. Set `apiKeys.github` to a token that can push branches + open PRs, and set each
   repo's `owner`/`repo`/`gitUrl` (an `https://github.com/<owner>/<repo>.git` URL).
2. Drive a `/command` as above. `submit_infra_change` opens a **real PR** and records an
   `InfraChange` row (visible in the admin UI under **Infra Changes**, or
   `GET /infra-changes`).
3. **Verify the PR gate:** the bot opened the PR but did **not** merge. Confirm on GitHub
   that the branch is `infra-bot/…` and the base is the deploy branch.
4. **Verify the watcher feedback loop:** lower `infraBot.watchPollIntervalMs` (e.g.
   `15000`) so you don't wait 5 min, then:
   - Approve the PR → within a poll the group gets a `:mag: Review: approved | CI: …` note.
   - Merge the PR → the group gets `:rocket: … merged — GitOps is deploying.` and the
     `InfraChange` row flips to `status: merged`.
   - Close without merging → the group gets a "closed without merging" note.

The watcher stops tracking a change once it reaches a terminal state (`merged`/`closed`),
so it won't keep polling closed PRs.

---

## Handy checks

- **Is the capability on?** Message the group `@Shade list the infra repos you can manage`.
  With the bot enabled you get the allowlist back; disabled, you get the "infra bot is
  disabled" message — a quick gate check.
- **Blast-radius check:** ask it to change a repo that is *not* in the allowlist. It must
  refuse with "not in the infra-bot allowlist," never touching anything.
- **Concurrency:** two `/command`s in a row asking for two different changes to the same
  repo should each get their own `infra-bot/…` branch (separate worktrees), with no
  cross-contamination — mirrors the `infraGit.test.ts` concurrency test.

See also `docs/testing/ai-harness.md` and the `/shade-harness` skill for the general
send-command → observe-result loop.
