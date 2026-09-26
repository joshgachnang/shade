import {afterEach, describe, expect, mock, test} from "bun:test";
import {AppConfig, reloadAppConfig} from "../models/appConfig";
import type {ExecFn} from "../orchestrator/runners/zerg";
import {setZergSessionsService, ZergSessionsService} from "../orchestrator/services/zergSessions";
import {buildZergTools} from "./zergTools";

const callTool = async (
  name: string,
  args: Record<string, unknown>
): Promise<{text: string; isError?: boolean}> => {
  const toolDef = buildZergTools().find((t) => t.name === name);
  if (!toolDef) {
    throw new Error(`Tool ${name} not registered`);
  }
  const handler = toolDef.handler as (
    a: unknown,
    e: unknown
  ) => Promise<{content: {text: string}[]; isError?: boolean}>;
  const result = await handler(args, {});
  return {text: result.content[0]?.text ?? "", isError: result.isError};
};

const rows = [
  {
    session: "shade-export",
    tmux: "shade|export",
    repo: "shade",
    feature: "export",
    state: "running",
    activity: {state: "working", since: "2026-09-26T17:59:30Z"},
    stage: "pick",
  },
  {
    session: "dotfiles-spike",
    tmux: "dotfiles|spike",
    repo: "dotfiles",
    feature: "spike",
    state: "running",
    activity: {state: "blocked", since: "2026-09-26T17:50:00Z"},
    stage: "grow",
    blockedOn: "ask: auth provider?",
  },
];

const installService = (exec: ExecFn): ZergSessionsService => {
  const service = new ZergSessionsService({exec});
  setZergSessionsService(service);
  return service;
};

describe("list_zerg_sessions", () => {
  afterEach(async () => {
    setZergSessionsService(null);
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("renders the dashboard table with needs-you rows first", async () => {
    const exec = mock<ExecFn>(async (argv) =>
      argv.join(" ").includes("inbox")
        ? {code: 1, stdout: "", stderr: ""}
        : {code: 0, stdout: JSON.stringify(rows), stderr: ""}
    );
    installService(exec);
    const {text, isError} = await callTool("list_zerg_sessions", {});
    expect(isError).toBeUndefined();
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^SESSION/);
    expect(lines[1]).toMatch(/^dotfiles\|spike \| ◆ blocked/);
    expect(lines[2]).toMatch(/^shade\|export \| working/);
    expect(text).toMatch(/2 running · 1 need you · 0 inbox pending$/);
  });

  test("repo, needsYouOnly and refresh are threaded through", async () => {
    const exec = mock<ExecFn>(async (argv) =>
      argv.join(" ").includes("inbox")
        ? {code: 1, stdout: "", stderr: ""}
        : {code: 0, stdout: JSON.stringify(rows), stderr: ""}
    );
    installService(exec);
    await callTool("list_zerg_sessions", {});
    const {text} = await callTool("list_zerg_sessions", {repo: "shade", needsYouOnly: true});
    expect(text).toContain("Nothing is waiting on you.");
    expect(text).not.toContain("dotfiles|spike");
    // Second call was served from cache (no refresh) — one dash exec + one inbox exec.
    expect(exec).toHaveBeenCalledTimes(2);
    await callTool("list_zerg_sessions", {refresh: true});
    expect(exec).toHaveBeenCalledTimes(4);
  });

  test("an unreachable zerg is reported in the text, not as a tool error", async () => {
    installService(async () => ({code: 255, stdout: "", stderr: "ssh: timed out"}));
    const {text, isError} = await callTool("list_zerg_sessions", {});
    expect(isError).toBeUndefined();
    expect(text).toMatch(/^⚠ zerg unreachable: .*timed out/);
  });

  test("is a tool error when zerg is disabled", async () => {
    await AppConfig.deleteMany({});
    await AppConfig.create({zerg: {enabled: false}});
    await reloadAppConfig();
    const exec = mock<ExecFn>(async () => ({code: 0, stdout: "[]", stderr: ""}));
    installService(exec);
    const {text, isError} = await callTool("list_zerg_sessions", {});
    expect(isError).toBe(true);
    expect(text).toMatch(/disabled/);
    expect(exec).not.toHaveBeenCalled();
  });
});
