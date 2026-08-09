---
name: infra-bot-verify
description: Verify the Infra Bot end to end against a running Shade using a local bare git repo (real agent, real git, no network, no GitHub). Use to confirm the infra-bot tools (list/prepare/submit) actually fire and produce a feature branch without touching real infrastructure.
---

# Infra Bot — Level 2 verification (offline live agent loop)

Drives a **running** Shade so the real agent calls the infra MCP tools against a
**local bare git repo** with **no GitHub token** — real git, zero network, zero
external services. Proves the "AI behind PR review" contract: the bot pushes a
feature branch and stops; the deploy branch never moves.

Full background: `docs/testing/infra-bot.md` (Level 2).

## Preconditions

- A Shade instance is running **with a real Anthropic key** (the mock/test-mode
  runner does NOT call MCP tools). Either `cd backend && bun run dev` in a
  worktree, or the local single-bundle deploy on `:4020`.
- ⚠️ **`:4020` is the live local production instance** (Atlas Mongo, real Apple
  integrations). Running this there mutates live `AppConfig.infraBot`, uses real
  LLM spend, and messages a real group. That's fine when the intent is to verify
  the deployed build — just be deliberate. Point `SHADE_URL` elsewhere to use a
  dev instance instead.
- Admin credentials for the target instance.

## Parameters

```bash
SHADE_URL="${SHADE_URL:-http://localhost:4020}"
# Provide creds via env, or paste a bearer token into TOKEN below.
# SHADE_ADMIN_EMAIL / SHADE_ADMIN_PASSWORD
```

## Steps

### 1. Stand up a local "git server" (bare repo) + seed a commit

```bash
INFRA_TMP=$(mktemp -d /tmp/infra-verify.XXXX)
git init --bare --initial-branch=main "$INFRA_TMP/stacks.git" >/dev/null
git init --initial-branch=main "$INFRA_TMP/seed" >/dev/null
git -C "$INFRA_TMP/seed" config user.email v@shade.local
git -C "$INFRA_TMP/seed" config user.name verify
printf 'services:\n  web:\n    image: nginx\n' > "$INFRA_TMP/seed/compose.yml"
git -C "$INFRA_TMP/seed" add -A
git -C "$INFRA_TMP/seed" commit -m init >/dev/null
git -C "$INFRA_TMP/seed" remote add origin "$INFRA_TMP/stacks.git"
git -C "$INFRA_TMP/seed" push -u origin main >/dev/null
MAIN_BEFORE=$(git -C "$INFRA_TMP/stacks.git" rev-parse main)
echo "bare repo: $INFRA_TMP/stacks.git  main=$MAIN_BEFORE"
```

### 2. Log in

```bash
TOKEN=$(curl -s -X POST "$SHADE_URL/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$SHADE_ADMIN_EMAIL\",\"password\":\"$SHADE_ADMIN_PASSWORD\"}" | jq -r .data.token)
AUTH="Authorization: Bearer $TOKEN"
[ "$TOKEN" != "null" ] && echo "logged in" || { echo "login failed"; exit 1; }
```

### 3. Pick a group to message, and record its id as `GROUP`

```bash
GROUP=$(curl -s "$SHADE_URL/groups?limit=1" -H "$AUTH" | jq -r '.data[0]._id')
echo "group: $GROUP"
```

### 4. Configure `AppConfig.infraBot` to point at the bare repo (empty GitHub token)

```bash
CFG_ID=$(curl -s "$SHADE_URL/app-configs" -H "$AUTH" | jq -r '.data[0]._id')
curl -s -X PATCH "$SHADE_URL/app-configs/$CFG_ID" -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"infraBot\":{\"enabled\":true,\"groupId\":\"$GROUP\",\"reposBaseDir\":\"data/infra-repos\",\"branchPrefix\":\"infra-bot/\",\"gitUserName\":\"Shade Infra Bot\",\"gitUserEmail\":\"infra-bot@shade.local\",\"watchPollIntervalMs\":300000,\"repos\":[{\"name\":\"stacks\",\"gitUrl\":\"$INFRA_TMP/stacks.git\",\"owner\":\"\",\"repo\":\"\",\"deployBranch\":\"main\",\"description\":\"Docker compose stacks\"}]}}" \
  | jq -r '.data.infraBot.enabled // .title'
```

The empty `owner`/`repo` + no `apiKeys.github` means `submit_infra_change` takes the
"pushed the branch, open the PR manually" path — real git push, no GitHub call.

### 5. Send the command (real agent runs)

```bash
curl -s -X POST "$SHADE_URL/command" -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"groupId\":\"$GROUP\",\"content\":\"@Shade Using the infra bot, add a redis service to the 'stacks' repo's compose.yml and submit it as a PR.\"}" \
  | jq -r '.data.groupId'
```

### 6. Wait for the run, then observe the agent's tool calls

```bash
# Give the agent a bit; then inspect the most recent run log for this group.
sleep 20
curl -s "$SHADE_URL/taskRunLogs?groupId=$GROUP&limit=1" -H "$AUTH" \
  | jq '.data[0] | {status, trigger, durationMs}'
```

Session transcripts (which tools fired) live under the instance's data dir:
`data/sessions/$GROUP/` (dev) — grep for `prepare_infra_change` / `submit_infra_change`.

### 7. Verify the git outcome — this is the real assertion

```bash
echo "feature branches:"; git -C "$INFRA_TMP/stacks.git" branch --list 'infra-bot/*'
BR=$(git -C "$INFRA_TMP/stacks.git" for-each-ref --format='%(refname:short)' 'refs/heads/infra-bot/*' | head -1)
echo "--- diff on $BR ---"; git -C "$INFRA_TMP/stacks.git" show "$BR" --stat | head -30
MAIN_AFTER=$(git -C "$INFRA_TMP/stacks.git" rev-parse main)
[ "$MAIN_AFTER" = "$MAIN_BEFORE" ] && echo "PASS: deploy branch untouched" || echo "FAIL: main moved!"
```

**Expected PASS state:**
- A `infra-bot/…` branch exists in the bare repo containing a redis edit to `compose.yml`.
- `main` is unchanged (`MAIN_AFTER == MAIN_BEFORE`).
- The agent's reply says it pushed the branch and a human must open/merge the PR — it
  did **not** merge or deploy.

### 8. Cleanup

```bash
rm -rf "$INFRA_TMP"
# Optional: turn the capability back off on the instance.
curl -s -X PATCH "$SHADE_URL/app-configs/$CFG_ID" -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"infraBot":{"enabled":false}}' >/dev/null
```

## Failure triage

- **No `infra-bot/*` branch, agent said tool disabled** → `infraBot.enabled` false or
  wrong `groupId`; re-check step 4 and that you messaged the same `GROUP`.
- **"not in the infra-bot allowlist"** → the repo `name` in the command must match a
  `repos[].name`; here it's `stacks`.
- **Run log `status: failed`** → open the session transcript under `data/sessions/$GROUP/`
  to see which git step errored (e.g. clone path wrong).
- **Nothing happened** → confirm the instance uses a real Anthropic key (not test mode);
  the mock runner never calls MCP tools.
