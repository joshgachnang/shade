import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {loadAppConfig, reloadAppConfig} from "../models/appConfig";
import type {AppConfigInfraBot} from "../types/models/appConfigTypes";
import {runGit} from "../utils/infraGit";
import {buildInfraTools} from "./infraTools";
import type {McpContext} from "./mcpServer";

const GROUP_ID = "infra-group";

const makeCtx = (groupId = GROUP_ID): McpContext => ({
  groupId,
  channelId: "chan",
  ipcDir: "/tmp/unused-ipc",
  groupFolder: "/tmp/unused",
});

const callInfra = async (
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext = makeCtx()
): Promise<{text: string; isError: boolean}> => {
  const tool = buildInfraTools(ctx).find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not registered`);
  }
  const handler = tool.handler as (
    a: unknown,
    e: unknown
  ) => Promise<{content: {text: string}[]; isError?: boolean}>;
  const res = await handler(args, {});
  return {text: res.content.map((c) => c.text).join("\n"), isError: res.isError ?? false};
};

const setInfra = async (patch: Partial<AppConfigInfraBot>): Promise<void> => {
  const config = await loadAppConfig();
  Object.assign(config.infraBot, patch);
  config.markModified("infraBot");
  await config.save();
  await reloadAppConfig();
};

describe("infra MCP tools", () => {
  let tmpRoot: string;
  let bareDir: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "infra-tools-"));
    bareDir = path.join(tmpRoot, "origin.git");
    const seedDir = path.join(tmpRoot, "seed");

    await runGit({cwd: tmpRoot, args: ["init", "--bare", "--initial-branch=main", bareDir]});
    await runGit({cwd: tmpRoot, args: ["init", "--initial-branch=main", seedDir]});
    await runGit({cwd: seedDir, args: ["config", "user.name", "Seed"]});
    await runGit({cwd: seedDir, args: ["config", "user.email", "seed@test.local"]});
    await fs.writeFile(path.join(seedDir, "compose.yml"), "services: {}\n");
    await runGit({cwd: seedDir, args: ["add", "-A"]});
    await runGit({cwd: seedDir, args: ["commit", "-m", "initial"]});
    await runGit({cwd: seedDir, args: ["remote", "add", "origin", bareDir]});
    await runGit({cwd: seedDir, args: ["push", "-u", "origin", "main"]});

    await setInfra({
      enabled: true,
      groupId: GROUP_ID,
      reposBaseDir: path.join(tmpRoot, "repos-base"),
      branchPrefix: "infra-bot/",
      gitUserName: "Shade Infra Bot",
      gitUserEmail: "infra-bot@shade.local",
      repos: [
        {
          name: "stacks",
          gitUrl: bareDir,
          owner: "acme",
          repo: "stacks",
          deployBranch: "main",
          description: "Docker compose stacks",
        },
      ],
    });
  });

  afterAll(async () => {
    await setInfra({enabled: false, groupId: "", repos: []});
    await fs.rm(tmpRoot, {recursive: true, force: true});
  });

  test("list_infra_repos returns the allowlisted repo", async () => {
    const {text, isError} = await callInfra("list_infra_repos", {});
    expect(isError).toBe(false);
    expect(text).toContain("stacks");
    expect(text).toContain("acme/stacks");
  });

  test("refuses calls from a group other than the configured one", async () => {
    const {isError, text} = await callInfra("list_infra_repos", {}, makeCtx("some-other-group"));
    expect(isError).toBe(true);
    expect(text).toContain("configured group");
  });

  test("prepare_infra_change refuses a repo not on the allowlist", async () => {
    const {isError, text} = await callInfra("prepare_infra_change", {
      repo: "prod-secrets",
      summary: "sneaky",
    });
    expect(isError).toBe(true);
    expect(text).toContain("not in the infra-bot allowlist");
  });

  test("prepare then submit pushes a feature branch and reports the no-token path", async () => {
    const prepared = await callInfra("prepare_infra_change", {
      repo: "stacks",
      summary: "Add nginx",
    });
    expect(prepared.isError).toBe(false);
    const parsed = JSON.parse(prepared.text) as {branch: string; workingDir: string};
    expect(parsed.branch.startsWith("infra-bot/add-nginx")).toBe(true);

    // Make an edit in the working tree the tool checked out.
    await fs.writeFile(path.join(parsed.workingDir, "nginx.yml"), "image: nginx\n");

    // No GitHub token is configured in the test AppConfig, so submit pushes the
    // branch and returns the "open the PR manually" path — exercising the real
    // git push without any network.
    const submitted = await callInfra("submit_infra_change", {
      repo: "stacks",
      branch: parsed.branch,
      title: "Add nginx service",
      body: "Adds an nginx compose service.",
    });
    expect(submitted.isError).toBe(false);
    expect(submitted.text).toContain("no GitHub token");

    // The branch really landed in the origin; the deploy branch is untouched.
    const branches = await runGit({cwd: bareDir, args: ["branch", "--list", parsed.branch]});
    expect(branches).toContain(parsed.branch);
  });

  test("tools are gated off when the feature is disabled", async () => {
    await setInfra({enabled: false});
    const {isError, text} = await callInfra("list_infra_repos", {});
    expect(isError).toBe(true);
    expect(text).toContain("disabled");
    await setInfra({enabled: true});
  });
});
