# Sandboxed Authenticated Agent Browser (IP-014) — Task List

Source: [Agent-Browser.md](../implementationPlans/Agent-Browser.md)

Decisions: Playwright persistent Chromium profile on the shade host; Xvfb + x11vnc + noVNC (Tailscale-only) for human logins/2FA; own in-process MCP tool suite; banking domains blocked by default.

## Phase 1: Infra

- [ ] **1.1** Provisioning: Xvfb/x11vnc/noVNC + `shade-browser.service` (`deploy/setup-browser.sh`, systemd unit); acceptance: VNC over Tailscale, cookies survive restart
- [ ] **1.2** `BrowserSession` model + `AppConfig.browser` block (enabled, headful, profileDir, novncPort, allowed/blockedDomains, maxSessionMinutes, screenshotOnError)
- [ ] **1.3** `BrowserSessionManager` (persistent context, run lock, session timeout)

## Phase 2: Tools

- [ ] **2.1** MCP tools: browser_goto / browser_snapshot (a11y tree) / browser_click / browser_type / browser_back / browser_tabs / browser_screenshot; fixture-page e2e form fill
- [ ] **2.2** Domain guard + navigation audit logging (info-level, session-review visible)

## Phase 3: Hardening + rollout

- [ ] **3.1** Login-wall handoff message (noVNC URL to group) + error screenshots to chat
- [ ] **3.2** `docs/browser-runbook.md` + prod enablement + first supervised real task
