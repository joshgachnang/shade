# Local Chrome Browser with Human Login Handoff

Shade can search the web but can't act behind a login. It has no browser automation, and IP-014 (a server-side Xvfb/noVNC browser) was planned but never built. This plan gives Shade's agents real Google Chrome on NangMini, the Mac mini that already runs the backend, driven through Playwright. Each skill gets its own named, persistent profile. When a site needs a password, an OTP, or a purchase decision, the agent posts a screenshot to Slack with a one-time link. The link opens a live view of the browser on s.nang.io, where you type straight into the page, and nothing you type passes through Slack, Mongo, logs, or the LLM. The first target is Amazon: log in once, then let a skill browse, read orders, and fill the cart, with every order placement waiting for your approval.

IP: IP-019
Priority: High
Effort: Big batch (1-2 weeks)
Supersedes: IP-014 (Sandboxed Authenticated Agent Browser)

## The idea

The gateway process on the mini owns a `BrowserManager`. It launches Chrome with `playwright-core` `launchPersistentContext(profileDir, {channel: "chrome", headless: false})`, keeping one user-data dir per named `BrowserProfile`. Agents drive it through a new `browser_*` MCP tool set. Pages are read snapshot-first, as an accessibility tree with element refs; a screenshot is taken only when asked for or sent to chat.

Human input runs through a `BrowserLiveSession`: a short-lived, token-addressed handle on one profile's page. The agent opens one with `browser_request_input` for typing; approvals happen in Slack itself (see below). Shade posts a screenshot plus the link to Slack. The s.nang.io page shows a refreshing screenshot and lets you click, type, and press keys; those events go straight to Playwright. When you press Done, Approve, or Deny, the gateway injects a synthetic inbound message into the group, and a new agent run picks the task back up. This is the same pattern Slack button clicks already use.

You can also ask to watch at any time. `browser_watch` opens a read-only live session and posts its link, so "show me the browser" works even when the agent isn't waiting on you.

Order placement and other irreversible submits are enforced in code, not in the prompt. The guard refuses an action if any of these hold:
- the target element's accessible name matches `browser.confirmPatterns` (for example "Place your order", "Cancel items", "Submit return");
- the action is Enter or `submit:true` on a page whose URL matches `browser.guardSubmitUrlPatterns` (for example `/checkout`, `/gp/buy`, `/returns`, `/a/addresses`);
- the action is `browser_goto` to a URL matching `browser.guardNavigateUrlPatterns`, which covers checkout and buy flows only. Order history and account pages stay readable, since you allowed "read orders".

A refused action goes through only with a matching approval. `browser_request_approval` posts the checkout screenshot to Slack with **Approve** and **Deny** buttons. It uses the existing button path (`app.action(/^shade:.+$/)` → `[user_action …]` in `channels/slack.ts`), and only clicks from `browser.approverSlackUserIds` count.

An approval is bound to the page it was shown for: the URL plus a sha256 of the page's order-summary text. That text comes from the `approvalSummarySelectors` entry for the host (falling back to `main`, then `body`), with whitespace collapsed. Any change to either cancels the approval.

Rejected alternative: a noVNC remote desktop (IP-014 D2-A). It needs Xvfb/x11vnc on Linux, which doesn't apply now that the backend runs on the mini, and it hands you the whole desktop when what's needed is one field.

## The plan

| # | Task | Lands in | Proves it |
| --- | --- | --- | --- |
| T1 | Launch a named Chrome profile and read a page | `backend/src/browser/`, models, AppConfig, `agentRunner/browserTools.ts` | bun test drives a fixture page; compiled-binary smoke |
| T2 | Interaction tools, profile lock, idle shutdown | `browser/manager.ts`, `browserTools.ts` | bun tests against fixture form |
| T3 | Worker-run access to the gateway's browser | `browser/client.ts`, `api/browserInternal.ts` | bun test: worker client drives fixture over HTTP |
| T4 | Send screenshots to Slack | channel connectors, IPC, `browser_screenshot` | IPC + Slack connector tests; harness outbox shows file |
| T5 | Secure live-input sessions and resume | `BrowserLiveSession`, `api/browserLive.ts`, tools | bun tests incl. secret-never-persisted assertion |
| T6 | Live view page on s.nang.io | `frontend/app/browser/[token].tsx` | Playwright e2e against harness |
| T7 | Guard for irreversible submits, with approval | `browser/guard.ts`, `browser_request_approval` | bun tests: refused, then allowed after approve |
| T8 | Skill-owned profiles and the Amazon skill | `orchestrator/skills.ts`, `builtinSkills.ts` | harness e2e on a fake-shop fixture, login → cart → approval |
| T9 | Runbook, close IP-014, rollout on the mini | `docs/`, IP index | docs present; `browser.enabled` rollout steps |

Tracer: T1 cuts the whole path end to end: AppConfig flag → `BrowserProfile` → `BrowserManager` launches Chrome → MCP tool returns a snapshot to the agent.
Out of scope: other machines/edge agents, noVNC, stealth/bot evasion, password-manager autofill, downloads/uploads, per-profile domain allowlists (see Expansions).
Open risks:
- `playwright-core` must work inside the `bun build --compile` executable. T1 proves this first; the fallback is spawning Chrome with `--remote-debugging-port` and using `connectOverCDP`.
- Amazon may flag automation. Using real Chrome with a persistent profile and a human-completed login is the mitigation; evasion is deferred.
- Headful Chrome on the mini needs a logged-in GUI session. The launchd LaunchAgent already runs in the user session.

## Architecture

### Topology

- **Host:** NangMini only (decision D1). Chrome runs headful on the mini's display; nothing binds a new network port.
- **Owner:** the gateway process (`SHADE_SERVICE=backend`). The live-view API lives in the gateway, so the browser must too.
- **Worker access:** agent runs in the worker process (board tasks) reach the browser through a `BrowserClient` interface.
  - In the gateway: an in-process implementation.
  - In the worker: an HTTP implementation calling a **separate** Express listener bound to `127.0.0.1:${browser.internalPort}` (default 4022), authenticated with `browser.internalToken`. Secrets are only generated when AppConfig is first created (`appConfig.ts` `if (!doc)`), and the mini already has one. So `loadAppConfig` generates and saves the token when it is missing, and the listener refuses to start with an empty token.
  - The internal API is never mounted on the public app on `PORT`. The Cloudflare Tunnel forwards to `localhost:4020`, so a loopback-address check on the public port would accept internet traffic.

### Models

- **`BrowserProfile`** (new): `{name (kebab-case, unique), displayName?, createdByGroupId, createdBySkill?, profileDir, status: "stopped"|"running"|"error", lockedByRunId?, lockedBySessionId?, lockedAt?, currentUrl?, lastUsedAt?, lastError?}`. `profileDir` = `${SHADE_DATA_DIR}/browser/profiles/<name>`.
- **`BrowserLiveSession`** (new): `{tokenHash, profileName, groupId, channelId, threadTs?, kind: "input"|"approval"|"watch", requestedByUserId?, claimedByUserId?, claimedAt?, approvalBinding?: {url, summaryHash}, maskedRefs: [string], prompt, fields?: [{label, ref?}], status: "open"|"done"|"approved"|"denied"|"expired"|"cancelled", nudgedAt?, expiresAt, createdByRunId}`.
  - Stores only a sha256 hash of the token; the raw token appears only in the link.
  - Never stores anything the human typed.
  - A TTL index on `expiresAt` removes old sessions.
- **`AppConfig.browser`** (new section):

| Field | Default | Purpose |
| --- | --- | --- |
| `enabled` | `false` | gates every tool and route |
| `channel` | `"chrome"` | Playwright channel; tests use `"chromium"` |
| `headless` | `false` | headful on the mini so you can also watch the screen |
| `maxOpenProfiles` | `3` | concurrent Chrome instances |
| `idleCloseMinutes` | `15` | close a profile's Chrome after inactivity |
| `liveSessionMinutes` | `15` | live-link lifetime |
| `nudgeAfterMinutes` | `5` | one reminder in Slack if still open |
| `publicBaseUrl` | `"https://s.nang.io"` | used to build the live link |
| `confirmPatterns` | `["place (your )?order", "buy now", "submit order", "complete purchase", "pay now", "confirm purchase", "cancel (items\|order)", "submit return", "subscribe", "1-click", "save address", "post review"]` | case-insensitive regexes on accessible names |
| `guardSubmitUrlPatterns` | `["/checkout", "/gp/buy", "/spc/", "/returns", "/a/addresses", "/gp/css/order-cancel"]` | URL regexes where Enter/`submit:true` is guarded |
| `guardNavigateUrlPatterns` | `["/checkout", "/gp/buy", "/spc/"]` | URL regexes `browser_goto` may not open directly |
| `approvalSummarySelectors` | `{"amazon.com": "#subtotals, #spc-orders, .order-summary"}` | per-host CSS selectors whose text defines the approval hash; fallback `main`, then `body` |
| `approverSlackUserIds` | `[]` | Slack user IDs whose button click counts as approval; empty = refuse all approvals |
| `screenshotChannelIds` | `[]` | extra channel IDs allowed to receive screenshots besides DMs |
| `approvalMinutes` | `10` | how long an approval stays valid |
| `maxSnapshotChars` | `20000` | trim limit for `browser_snapshot` |
| `sweepIntervalSeconds` | `30` | dedicated nudge/expiry sweep interval |
| `internalPort` | `4022` | loopback-only listener for worker → gateway |
| `internalToken` | generated | worker → gateway auth |

### MCP tools (`agentRunner/browserTools.ts`, spread into `buildTools`)

Every result includes `{profile, url, title}`. Every tool errors with a clear message when `browser.enabled` is false.

| Tool | Does |
| --- | --- |
| `browser_profile_create({name, displayName?})` | creates the profile (idempotent); records group and skill |
| `browser_profile_list()` | name, status, last URL, last used |
| `browser_open({profile, url?})` | launches or attaches to the profile, takes the run lock, optionally navigates |
| `browser_snapshot({profile})` | trimmed accessibility tree with `ref`s |
| `browser_goto` / `browser_back` | navigation (logged at info: `browser: <profile> goto <host><path>`, no query string) |
| `browser_click({profile, ref})` | subject to the purchase guard |
| `browser_type({profile, ref, text, submit?})` | refuses fields of `type=password`: the agent must use `browser_request_input` |
| `browser_press({profile, key})` | subject to the guard when focus is on a guarded element |
| `browser_tabs({profile, action, index?})` | list/switch/close tabs |
| `browser_screenshot({profile, sendToChat?, caption?})` | returns an image to the agent; optionally posts it to the current thread, only if the run's channel is a DM or listed in `screenshotChannelIds` (otherwise an error) |
| `browser_request_input({profile, prompt, fields?})` | opens an input live session, posts screenshot + link + prompt, returns immediately |
| `browser_request_approval({profile, summary})` | posts a checkout screenshot + summary with Approve/Deny Slack buttons; records an approval bound to URL + summary hash; returns immediately |
| `browser_watch({profile})` | opens a read-only watch session and posts the link (used for "show me the browser") |
| `browser_close({profile})` | releases the lock and closes Chrome |

### Live-session API (`api/browserLive.ts`, gateway)

- **Auth:** each request needs the raw token in the path and a signed-in Shade user (existing JWT auth).
  - The user must be a Shade admin. `User` has no Slack identity (`models/user.ts`), and you are the only admin.
  - The token is checked against `tokenHash`, `status=open`, and `expiresAt`.
  - The first opener claims the session (`claimedByUserId`), which makes the link one-time; any other user then gets 404.
  - Mismatch, expiry, and wrong claimant are indistinguishable (404).
  - Watch sessions accept only `GET` routes.

| Route | Does |
| --- | --- |
| `GET /browser-live/:token` | `{kind, prompt, fields, profile, status, url, title}` |
| `GET /browser-live/:token/screenshot` | JPEG of the current viewport (`Cache-Control: no-store`) |
| `POST /browser-live/:token/click` `{x, y}` | mouse click at viewport coordinates |
| `POST /browser-live/:token/type` `{text}` | `keyboard.type` into the focused element |
| `POST /browser-live/:token/key` `{key}` | allowlisted keys: Enter, Tab, Backspace, Escape, arrows |
| `POST /browser-live/:token/fill` `{fieldIndex, text}` | focuses the requested field's ref and fills it (the primary input path) |
| `POST /browser-live/:token/finish` `{outcome}` | `done` or `cancelled` (input sessions only) |

- **Secret handling:** the `type` route's body is never logged, stored, sent to Sentry, or echoed back.
  - The route is excluded from request logging and its body is scrubbed in Sentry `beforeSend`.
  - Human-typed text is not captured by the purchase guard or by navigation logs.
  - Every element that receives typing through a live session is recorded in `maskedRefs` (by element handle id).
  - `browser_snapshot` replaces the values of those elements, and of all `password`/`one-time-code`/OTP-like inputs, with `••••`.
  - `browser_screenshot` and live-view screenshots draw an opaque box over the same elements before encoding.
  - Result: the agent and Slack never see what you typed.
- **Resume:** `finish` calls a new public `ChannelManager.injectSyntheticMessage({groupId, channelId, threadTs, content, metadata})`.
  - It wraps the private `handleInboundMessage` with a unique `externalId` (`browser_live:<sessionId>:<outcome>`).
  - The message is `[browser_live <outcome> profile=<name> session=<id>]`, posted in the same thread.
  - `metadata.alwaysTrigger=true` makes `shouldTrigger` start a run even in `requiresTrigger` groups. Its signature changes from `(content, group)` to `({content, metadata, group})` in `orchestrator/router.ts`, and the call site in `messageLoop.ts` passes the stored message's metadata. Slack approval clicks arrive as `[user_action …]` messages and get the same flag.
  - Cancel and expiry inject the same message with `outcome=expired|cancelled`.
- **Profile hold:** while an input session or pending approval is open, the profile's lock is held by the session (`lockedBySessionId`), not by the finished run, and the profile is exempt from idle close.
  - The synthetic message includes `session=<id>`.
  - The resumed run calls `browser_open({profile, resumeSession: id})`, which moves the lock to that run.
  - Any other `browser_open` gets "profile busy".
  - Board tasks that open a session resume as a chat run in the task's group and thread. They do not resume as a board task.
- **Nudge:** a dedicated `setInterval` sweep (`browser.sweepIntervalSeconds`) in the gateway posts one reminder in the thread after `nudgeAfterMinutes`, and marks sessions expired after `liveSessionMinutes`. The scheduler tick is not used because it can sleep for up to 5 minutes.

### Slack images

- `ChannelConnector` gains an optional `sendFile({channelId, threadTs?, filename, bytes, mimeType, caption?})`.
- The Slack connector implements it with `files.uploadV2`, which needs the `files:write` scope; the rollout adds it to the Slack app.
- The `test` channel records files in the harness outbox.
- New IPC type `send_file`: the tool writes a PNG under the group folder's `ipc/files/` and the IPC payload references its path. The consumer deletes the file after sending.
- Connectors without `sendFile` fall back to text: "Screenshot available in the console".

### Skill-owned profiles

- Skill frontmatter gains an optional `browserProfile: <name>`, parsed by `parseSkillFile`.
- `load_skill` prepends "This skill uses browser profile `<name>`; create it with `browser_profile_create` if missing."
- `list_skills` shows the profile.
- `save_skill` accepts an optional `browserProfile` argument.
- `browser_profile_create` records `createdBySkill` when the run loaded a skill.

## Task list

- [ ] **T1** — Launch a named Chrome profile and read a page
  - Files: `backend/src/browser/manager.ts` (+ test), `backend/src/models/browserProfile.ts`, `backend/src/types/models/browserProfileTypes.ts`, `appConfig.ts` + `appConfigTypes.ts` (`browser` section), `backend/src/agentRunner/browserTools.ts` (+ test), register in `mcpServer.ts` `buildTools`, `backend/package.json` (`playwright-core`), `.github/workflows/backend-ci.yml` (add `bunx playwright install --with-deps chromium`), `.github/workflows/deploy-mini.yml` (post-update smoke)
  - Tools: `browser_profile_create`, `browser_profile_list`, `browser_open`, `browser_snapshot`, `browser_close`
  - Launch: turn off Chrome's password manager and autofill through profile prefs (`credentials_enable_service=false`, `profile.password_manager_enabled=false`, `autofill.profile_enabled=false`, `autofill.credit_card_enabled=false`).
  - Criteria:
    - bun test with `browser.channel="chromium"`, headless, serving a fixture HTML page from a local Bun server: `browser_open` then `browser_snapshot` returns the page title and a button ref.
    - Profile dir persists a cookie across close/open.
    - After a fixture login form is submitted, the profile's `Login Data` has no rows (sqlite check), and the prefs file has password saving turned off.
    - Tools return an error while `browser.enabled=false`.
    - `./shade build` then `dist/shade browser-smoke` (new hidden subcommand: launch a browser on a data URL and print the title) exits 0 in backend CI with chromium.
    - `deploy-mini.yml` runs `shade browser-smoke --channel chrome` on the mini after `./shade update`, and a non-zero exit fails the deploy. This tests the shipped darwin binary against installed Chrome.
    - Backend CI installs Chromium and runs the browser tests green.
  - Blockers: none
  - Docs: `docs/architecture/agents-and-tools.md` (browser tool section), `docs/architecture/backend.md` (models)
  - Skills: shade-harness (for later tasks), terreno-shared conventions
- [ ] **T2** — Add browser interaction tools, profile locking, and idle shutdown
  - Tools: `browser_goto`, `browser_back`, `browser_click`, `browser_type`, `browser_press`, `browser_tabs`
  - Criteria:
    - Fixture form is filled and submitted via refs; the result page text is visible in the snapshot.
    - `browser_type` on a password field returns an error naming `browser_request_input`.
    - A second run's `browser_open` on a locked profile returns "profile busy (run <id>)".
    - The lock is released on `browser_close`, on run end (runner cleanup hook), and on `idleCloseMinutes` (fake timer test), except while a live session holds it (covered in T5).
    - `maxOpenProfiles` is enforced.
    - Navigation info log has host+path with no query.
  - Blockers: T1
  - Docs: agents-and-tools.md
- [ ] **T3** — Let worker agent runs drive the gateway's browser over loopback HTTP
  - Files: `backend/src/browser/client.ts` (in-process + HTTP impl), `backend/src/browser/internalServer.ts` (separate listener on `127.0.0.1:internalPort`), `browserTools.ts` uses `BrowserClient`
  - Criteria:
    - A bun test starts the internal listener and drives the fixture page from the HTTP client.
    - A missing or wrong token → 401.
    - A test asserts `/internal/browser/*` returns 404 on the public app (`PORT`), including with a valid token and `cf-connecting-ip` set.
    - The listener's bound address is `127.0.0.1`.
    - Starting from an existing AppConfig with no `browser` section, `loadAppConfig` fills in a non-empty `internalToken`.
    - An empty token stops the listener from starting.
    - The worker runtime selects the HTTP client (`SHADE_SERVICE=worker`).
  - Blockers: T2
  - Docs: `docs/architecture/orchestrator.md` (gateway/worker section)
- [ ] **T4** — Send browser screenshots to Slack
  - Files: `orchestrator/channels/types.ts`, `channels/slack.ts`, test channel connector, `orchestrator/ipcWriter.ts`/`ipc.ts` (`send_file`), `browser_screenshot` in `browserTools.ts`
  - Criteria:
    - The IPC test asserts the `send_file` payload and that the temp file is deleted after dispatch.
    - The Slack connector test (mocked `WebClient`) calls `files.uploadV2` with the channel, `thread_ts`, and bytes.
    - Harness: a fixture action calling `browser_screenshot({sendToChat:true})` makes `GET /test/outbox` show a file entry.
    - A connector without `sendFile` gets the text fallback.
    - `sendToChat` from a non-DM channel not in `screenshotChannelIds` returns an error and posts nothing. Live-session and approval posts obey the same rule.
  - Blockers: T1
  - Docs: agents-and-tools.md, `docs/testing/ai-harness.md` (outbox file entries)
- [ ] **T5** — Add secure live-input sessions that resume the agent
  - Files: `backend/src/models/browserLiveSession.ts` (+ types), `backend/src/api/browserLive.ts`, `browser_request_input` + `browser_watch` in `browserTools.ts`, `ChannelManager.injectSyntheticMessage`, `shouldTrigger` signature in `orchestrator/router.ts` + its call in `orchestrator/messageLoop.ts`, masking in `browser/manager.ts`, the dedicated sweep interval, Sentry `beforeSend` scrub, request-log exclusion
  - Criteria:
    - The tool posts a screenshot and a link containing a 32-byte base64url token; the DB holds only its hash.
    - The click/type/key routes change the fixture page.
    - `/fill` with `fieldIndex` fills exactly that ref, even when another element has focus.
    - Sentinel test, filling `S3CRET-SENTINEL` into a plain text field through `/fill` and typing `OTP-999999` into an OTP field through `/type`:
      - neither appears in any Mongo collection (scans all collections), captured logger output, Sentry event payload, response body, or IPC file;
      - neither appears in the next `browser_snapshot` output;
      - the masked-region pixels in `browser_screenshot` are uniform (tested by comparing crop pixel variance to zero).
    - `finish` creates a synthetic inbound message that `messageLoop` turns into a new mock run in a group with `requiresTrigger=true` (tested through `tickHarness`, not the router alone).
    - The nudge is posted exactly once within `sweepIntervalSeconds` of `nudgeAfterMinutes` (fake timers); an expired token returns 404.
    - An unauthenticated request returns 401 even with a valid token.
    - A second user opening a claimed token gets 404; a non-admin who isn't the requester gets 404.
    - With a session open and time advanced past `idleCloseMinutes`, Chrome is still running and `browser_open` from another run returns busy.
    - `browser_watch` returns a link whose POST routes return 404.
    - `browser_open({resumeSession})` after `finish` takes the lock; a run without it gets busy.
    - A session opened from a board-task run resumes as a chat run in that group (harness).
  - Blockers: T2, T4
  - Docs: new `docs/architecture/browser.md` (explanation: live sessions and the secret boundary)
- [ ] **T6** — Build the live view page on s.nang.io
  - Files: `frontend/app/browser/[token].tsx`, components under `frontend/components/browserLive/`, SDK regen (`bun run sdk`), QA cases in `qa/` per `.claude/qa-test-case-format.md`
  - Page contents (input and watch sessions; approvals are Slack buttons):
    - screenshot refreshed every 1s (paused when the tab is hidden)
    - click-to-click on the image, with viewport coordinate scaling
    - one masked input per requested field (from `fields`), each sent to `/fill` for that field's ref and cleared after sending
    - a fallback free-typing box that sends to `/type` (focused element)
    - key buttons
    - Done or Cancel
    - an expired state
    - a read-only watch mode (screenshot and URL only)
    - `_layout.tsx` keeps a return-to path so a signed-out user returns to `/browser/<token>` after login
  - Criteria:
    - The Playwright e2e test (per `.claude/playwright-rules.md`) against `bun run dev:test` with a fixture login page: sign in, open the link, fill the email and password fields in their own boxes, and press Done, then assert the fixture page shows "logged in" and a new run fired.
    - A second e2e case starts signed out, logs in, and lands back on the live page with the token intact.
    - `testID`s on every control.
    - The P0/P1 QA cases are written.
  - Blockers: T5
  - Docs: `docs/architecture/frontend.md` (route)
- [ ] **T7** — Guard orders and irreversible submits behind a Slack approval
  - Files: `backend/src/browser/guard.ts` (+ test), `browser_request_approval` in `browserTools.ts`, approval-button handling in `orchestrator/channels/slack.ts` (reuse `shade:` action ids) and the IPC/rich-response path
  - Criteria:
    - A fixture checkout page with a "Place your order" button: `browser_click` is refused with a message naming `browser_request_approval`.
    - A Slack Approve click from a user not in `approverSlackUserIds` is ignored (mocked Bolt action test).
    - After an Approve click from an allowed user, exactly one guarded action on that same URL and summary hash is allowed within `approvalMinutes`; a second is refused again.
    - After approval, a change to the fixture cart total inside `#subtotals` (the summary hash changes) → refused. A rotating ad outside the selector doesn't change the hash, so the action is allowed. Navigating away cancels the approval.
    - `browser_goto` to fixture `/gp/css/order-history` is allowed; `browser_goto` to `/gp/buy/…` is refused.
    - `denied` keeps it refused.
    - Patterns come from AppConfig (a test overrides them).
    - Guarded without approval:
      - `browser_press("Enter")` on a `guardSubmitUrlPatterns` URL;
      - `browser_type({submit:true})` on a `guardSubmitUrlPatterns` URL;
      - `browser_goto` to a `guardNavigateUrlPatterns` URL;
      - a click on a child span inside a guarded button (the guard checks ancestors' accessible names).
    - Fixture "Cancel order" and "Submit return" buttons are refused; ordinary cart add/remove is allowed.
  - Blockers: T5
  - Docs: browser.md (guard section)
- [ ] **T8** — Let skills own browser profiles and seed the Amazon shopping skill
  - Files: `orchestrator/skills.ts` (`browserProfile` frontmatter), `save_skill`/`load_skill`/`list_skills` in `mcpServer.ts`, `orchestrator/builtinSkills.ts` (`amazon-shopping`: open profile `amazon`, detect the sign-in page, `browser_request_input` for credentials/OTP, snapshot-first browsing, cart only, `browser_request_approval` before checkout), fake-shop fixture pages under `backend/src/tests/fixtures/fakeShop/`
  - Criteria:
    - Skills unit tests cover frontmatter parse and the `load_skill` preamble.
    - Harness e2e (bun, `testHelper.ts`) with mock-runner fixtures follows the skill steps on the fake shop:
      - the input request is posted with a file;
      - the live `/type` + `finish` logs in;
      - the resumed run adds to cart;
      - the guarded click is refused;
      - an approval with a file and Approve/Deny buttons is posted;
      - after a simulated Approve action, the order confirmation page is reached.
    - The built-in skill seeds without overwriting an edited copy.
  - Blockers: T6, T7
  - Docs: browser.md (writing a browser skill), agents-and-tools.md (skills frontmatter)
- [ ] **T9** — Write the browser runbook and close IP-014
  - Files: `docs/browser-runbook.md` (how-to: enable, Slack `files:write` scope, first Amazon login, where profiles live, how to wipe a profile), `PLAN_INDEX.md` (IP-019 added, IP-014 → Closed/superseded), `Agent-Browser.md` status Closed with a pointer, `docs/architecture/deployment.md` (Chrome on the mini, profile dir is sensitive, excluded from backups)
  - Criteria: `bun run lint` and the docs link check pass; the runbook's rollout steps are the ones in Rollout below.
  - Blockers: T8
  - Docs: this task

## Assumptions

- `playwright-core` (not `@playwright/test`) in `backend`; Chrome itself is the one installed on the mini.
- Snapshot uses Playwright's `ariaSnapshot` with refs, trimmed to `browser.maxSnapshotChars`.
- The live page lives in the existing Expo web app (s.nang.io) behind its existing login rather than as a standalone HTML page, so it inherits auth.
- Synthetic resume messages follow the Slack button-click pattern (`[user_action …]` in `channels/slack.ts`).
- Tests use headless bundled Chromium. Only `e2e.yml` installs it today, so T1 adds the install to `backend-ci.yml`.
- "Local Chrome" means the Chrome installed on the mini (decision D1), not the Chrome profile you use day to day. Each skill profile starts empty and you log in once through the live page.

## Rollout

1. Merge with `browser.enabled=false`; nothing changes.
2. Add the `files:write` scope to the Slack app and reinstall.
3. In the admin UI: set `browser.enabled=true` and `richResponses.enabled=true` (the Slack buttons need it), and set `approverSlackUserIds` to your Slack user ID.
4. Ask Shade in your DM: "use the amazon-shopping skill and show me my last order". Complete the login on the live page, then check that the Slack thread shows the screenshot and the order summary.
5. Watch the navigation logs for a week before using other sites.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q4 | Should the agent be able to send you a screenshot of any page, including account pages? | Yes, but only to DMs or allowlisted channels (enforced in T4) | Needed for "view what's going on"; account and checkout pages show your address and card | Restrict screenshots to live-session requests only | T4 |
| Q5 | Headful Chrome on the mini's display (you can watch it on the mini too) or headless? | Headful | Fewer bot flags on Amazon; lets you watch via Screen Sharing if you want | Headless: invisible, and possibly more CAPTCHAs | T1 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Browser edge agent to drive Chrome on your laptop or other Macs | "Which Chrome" alternatives | L | T3 client seam |
| X2 | Per-profile allowed/blocked domains | IP-014 domain guard | S | T2 |
| X3 | Stealth/bot-evasion (Camoufox, fingerprinting) | Amazon automation risk | M | T1 |
| X4 | Live video (CDP screencast over websocket) instead of 1s screenshots | Live view smoothness | M | T6 |
| X5 | Embed live view in the console app, list of profiles in the admin UI (on-demand watch via `browser_watch` is in scope) | Observability | S | T6 |
| X6 | Password-manager integration for autofill | Fewer manual logins | M | T5 |
| X7 | Downloads (receipts, invoices) saved to the group folder | Order history use cases | S | T2 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | Which Chrome should Shade drive? | Mac mini only: the backend launches Chrome on the mini itself | No edge agent; the gateway owns the browser; the worker reaches it over loopback (T3) |
| D2 | How should login input reach the browser? | Secure web page: a one-time link to a live view on s.nang.io that types directly into the page | T5/T6; secrets never touch Slack, Mongo, logs, or the LLM |
| D3 | What may the agent do on shopping sites unattended? | Browse, read orders, add to cart; placing an order or any irreversible submit needs explicit approval in Slack with a checkout screenshot | T7 guard in code (names + submit URLs + checkout navigation), Slack Approve/Deny buttons, approval bound to the page shown |
| D4 | Q1: When the agent asks you to log in, should its run end and resume via a new run, or block and wait? | End and resume (recommendation) | As planned: synthetic resume message |
| D5 | Q2: Close IP-014 as superseded? | Close it (recommendation) | T9 closes IP-014 |
| D6 | Q3: Fresh per-skill profiles on the mini, or reuse an existing Chrome profile? | Fresh per-skill (recommendation) | As planned |
| D7 | Approve the plan? | Approved 2026-09-30; Q4 and Q5 stand on their recommendations | barrel may start |

## Sign-off

Status: approved 2026-09-30
Cut: 2 rounds, 23 findings: 22 fixed, 0 moved to questions or expansions, 1 rebutted (round 2 F11 "use IP-018": IP-018 already exists on a remote branch, commit 1e318cd "IP-018: Plan brewery-driven feature channels")
