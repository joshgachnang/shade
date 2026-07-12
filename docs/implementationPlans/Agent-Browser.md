# Implementation Plan: Sandboxed Authenticated Agent Browser

**Status:** Open
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-014

Give Shade a persistent, server-side browser it can drive — one that stays logged into the user's accounts. This is the "hybrid browser" from the Joshu setup: a browser-in-a-VNC-session on the server where the *human* logs in / passes 2FA once by hand, and the *agent* uses the authenticated session afterward. It unlocks the task class Shade currently can't touch at all (anything behind a login: marketplace listings, account admin, forms), since today the agent has zero browser automation — only search APIs.

## Decisions & Options

### D1: Browser engine & automation layer

- **A (recommended): Playwright + persistent Chromium profile.** `chromium.launchPersistentContext(profileDir)` keeps cookies/localStorage across restarts. Playwright is already a repo dependency (e2e tests), well-understood, and its accessibility snapshot gives the agent a text representation of pages that is far cheaper than screenshots.
- **B: Camoufox (hardened Firefox, what Joshu uses).** Better bot-detection evasion for hostile sites (Facebook, LinkedIn). Heavier setup (separate binary), Firefox-only quirks. Can be adopted later behind the same interface if Chromium gets blocked where it matters.
- **C: Chrome DevTools Protocol against a long-lived headful Chrome.** Most "real" browser, least abstraction; more plumbing to build ourselves.

### D2: Human-in-the-loop view (for logins/2FA and watching the agent work)

- **A (recommended): headful browser inside Xvfb + x11vnc + noVNC**, reverse-proxied on the Tailscale interface only. One systemd unit (`shade-browser.service`). You open the noVNC page, log into a site once, done; you can also watch the agent live — the "joint human+AI operation" idea in miniature.
- **B: Playwright headless + screenshot relay into chat** when a login wall is hit. No new service, but 2FA/CAPTCHA flows through screenshots are miserable.
- **C: Chrome remote debugging + Tailscale port.** Minimal, but the DevTools UI is a bad login surface.

### D3: How the agent drives it

- **A (recommended): MCP tools in the existing in-process server** (`browser_goto`, `browser_snapshot` (a11y tree + URL), `browser_click`, `browser_type`, `browser_screenshot` (only when snapshot is insufficient), `browser_back`, `browser_tabs`). Direct, testable, consistent with every other Shade capability; tools talk to a `BrowserSessionManager` over the persistent context.
- **B: Wire up `@playwright/mcp` (official Playwright MCP server) as an external MCP server.** Much less code to own, but Shade's runner currently builds one in-process MCP server; adding external-server plumbing is its own work, and per-group isolation/config is harder to enforce.

## Models

- **`BrowserSession`** (new, mostly observability): `{name: string, profileDir: string, status: "running" | "stopped" | "error", currentUrl?: string, lastUsedAt?: Date, lockedByRunId?: string}`. One default session to start; the model leaves room for per-purpose profiles later.
- **`AppConfig.browser`**: `enabled` (default false), `headful` (default true), `profileDir` (default under `SHADE_DATA_DIR/browser`), `novncPort`, `allowedDomains: string[]` (empty = allow all), `blockedDomains: string[]` (banking etc.), `maxSessionMinutes` (kill runaway sessions), `screenshotOnError` (default true).

## APIs

- MCP tools per D3-A. Every tool result includes `{url, title}` so the agent always knows where it is. `browser_snapshot` returns the Playwright accessibility tree (trimmed, with element refs the click/type tools accept) — snapshot-first, screenshots as fallback keeps token cost sane (the Joshu post makes exactly this point about screenshot-driven computer use).
- Domain guard: every navigation checks `allowedDomains`/`blockedDomains`; blocked → tool error text, logged.
- Concurrency: one agent run holds the session at a time (`lockedByRunId` + queue); a second run gets "browser busy" rather than fighting over the mouse.
- REST: none beyond generic admin CRUD over `BrowserSession`.

## Notifications

When the agent hits a login wall or CAPTCHA it cannot pass, it messages the group: "I need you to log into {site} — open {noVNC URL}" (URL from AppConfig, Tailscale-only). No other notifications.

## UI

None in the Expo app for v1 (the noVNC page is the UI). Fast-follow candidate: embed the noVNC iframe in a console tab (pairs with IP-005 Rich Response UI).

## Phases

1. **Infra**: Xvfb + x11vnc + noVNC provisioning in `deploy/` (systemd unit + setup script section), `BrowserSessionManager` with persistent context, AppConfig section. Manual acceptance: VNC in browser, log into a site, cookies survive service restart.
2. **Tools**: MCP tool suite + domain guard + lock/queue + tests (Playwright against a local fixture page; no external sites in CI).
3. **Hardening + rollout**: session timeout, error screenshots to group chat, login-wall handoff message, `docs/` runbook (how to add a new authenticated site). Enable in prod; first real task: something harmless and reversible.

## Feature Flags & Migrations

`browser.enabled` gates everything (default off). No migrations. Security posture: noVNC bound to the Tailscale interface only, never proxied through Cloudflare; profile dir holds live session cookies → explicitly excluded from any future backup-to-cloud path and documented as sensitive; `blockedDomains` pre-seeded with financial domains.

## Activity Log & User Updates

Every `browser_*` tool call already lands in session transcripts. Additionally log navigations at info level (`browser: goto facebook.com/marketplace`) so the session-review skill can audit browser activity — the red-flag loop (IP shipped alongside this) is the safety net for "agent doing weird things in my accounts."

## Not Included / Future Work

- Bot-detection evasion (Camoufox swap) — only if/when a target site blocks Chromium.
- Multiple named profiles ("personal", "business") — model supports it, tools target the default.
- Autonomous credential entry / password-manager integration — the human logs in via VNC, full stop.
- Downloads/uploads pipeline, mobile-viewport emulation.

## Decisions (2026-07-12)

1. **D2 = A**: noVNC on the shade host, Tailscale-only. Host confirmed to have RAM headroom for persistent Chromium, so the service stays on the shade host (not the Mac mini).
2. **D1 = A, D3 = A** (assumptions, per recommendation): Playwright persistent Chromium profile; own the small in-process MCP tool suite.
3. **Blocked domains**: seed with financial domains only; extend via admin UI as needed.

---

## Task List

### Phase 1: Infra

- [ ] **Task 1.1**: Provisioning — Xvfb/x11vnc/noVNC + `shade-browser.service`
  - Files: `deploy/setup-browser.sh`, `deploy/shade-browser.service`, docs
  - Acceptance: VNC reachable over Tailscale; login cookies survive restart
- [ ] **Task 1.2**: `BrowserSession` model + `AppConfig.browser`
  - Files: `backend/src/models/browserSession.ts`, types, `appConfig.ts`
- [ ] **Task 1.3**: `BrowserSessionManager` (persistent context, lock, timeout)
  - Files: `backend/src/orchestrator/services/browserManager.ts` (+ tests)

### Phase 2: Tools

- [ ] **Task 2.1**: MCP tools goto/snapshot/click/type/back/tabs/screenshot
  - Files: `backend/src/agentRunner/browserTools.ts`, registered in `mcpServer.ts`
  - Acceptance: fixture-page test drives a form fill end-to-end
- [ ] **Task 2.2**: Domain guard + navigation audit logging
  - Acceptance: blocked domain returns tool error; navs logged at info

### Phase 3: Hardening + rollout

- [ ] **Task 3.1**: Login-wall handoff message + error screenshots to chat
- [ ] **Task 3.2**: Runbook + prod enablement + first supervised real task
  - Files: `docs/browser-runbook.md`
