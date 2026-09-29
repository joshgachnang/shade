import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {loadAppConfig} from "../../models/appConfig";
import type {BreweryState, FeatureDocument} from "../../types/models/featureTypes";
import type {GroupDocument} from "../../types/models/groupTypes";
import {ensureLocalRepo, featureSlugForRepo} from "../featureWorkspace";
import {defaultExec, type ExecFn, shellQuote, withSshHost} from "../hostExec";
import {
  buildUpArgs,
  parseUpOutput,
  validateContainerTarget,
  zergSessionName,
} from "../runners/zerg";

class StartupError extends Error {}

type SendMessage = (channel: string, target: string, text: string) => Promise<void>;
type Launch = (argv: string[], cwd: string, logPath: string) => Promise<void>;

/** Resolve on successful spawn; brewery owns the detached process and its run.pid. */
const launchDetached: Launch = async (argv, cwd, logPath) => {
  const log = await fs.open(logPath, "a", 0o600);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    await log.close();
  }
};

/** The CLI's agents report is intentionally checked before detaching a run. */
const verifyAgents = (report: string): void => {
  const available = new Set([...report.matchAll(/^\s*✓\s+(\S+)/gm)].map((match) => match[1]));
  for (const stage of ["distill", "cut", "pick", "roast", "review", "brew", "taste"]) {
    const row = report.match(new RegExp(`^\\s*${stage}\\s+(?:first of|all of)\\s+(.+)$`, "m"));
    if (!row || !row[1]!.split(",").some((name) => available.has(name.trim()))) {
      throw new StartupError(
        `No available brewery agent for ${stage}. Install the configured agents or fix AppConfig.brewery.agents, then retry.`
      );
    }
  }
};

export class BreweryDriver {
  constructor(
    private readonly options: {
      sendMessage: SendMessage;
      exec?: ExecFn;
      launch?: Launch;
      loadConfig?: typeof loadAppConfig;
    }
  ) {}

  async start({
    feature,
    group,
    request,
    repo,
  }: {
    feature: FeatureDocument;
    group: GroupDocument;
    request: string;
    /** create_feature's repository, retained explicitly for local execution. */
    repo?: string;
  }): Promise<BreweryState> {
    if (feature.brewery)
      throw new StartupError(
        "This feature already has a brewery run. Use resume instead of starting it again."
      );
    const exec = this.options.exec ?? defaultExec;
    let failure =
      "Unable to start brewery. Check AppConfig.brewery and workspace access, then retry.";
    try {
      if (!request.trim())
        throw new StartupError(
          "A non-empty feature request is required. Supply a request and retry."
        );
      const repository = (repo ?? group.executionConfig?.zergRepo ?? "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(repository)) {
        throw new StartupError(
          "A valid repository is required (repo or owner/repo). Set the repository and retry."
        );
      }
      const config = await (this.options.loadConfig ?? loadAppConfig)();
      const slug = `${featureSlugForRepo({channelName: group.name, repo: repository}).slice(0, 14)}-${feature._id.toString()}`;
      let cwd: string;
      let workspace: BreweryState["workspace"];
      let inWorkspace: (argv: string[]) => string[];
      const checked = async (argv: string[], message: string): Promise<string> => {
        failure = message;
        const result = await exec(argv, {timeoutMs: config.zerg.upTimeoutMs});
        if (result.code !== 0) throw new StartupError(message);
        return result.stdout;
      };
      if (config.zerg.enabled) {
        const target = {repo: repository.split("/").pop()!, feature: slug};
        validateContainerTarget(target);
        const output = await checked(
          withSshHost(buildUpArgs(config.zerg, target), config.zerg.sshHost),
          "Unable to create the zerg workspace. Check AppConfig.zerg and host access, then retry."
        );
        const session = parseUpOutput(output)?.session ?? zergSessionName(target);
        workspace = {kind: "zerg", session};
        cwd = config.zerg.workdir;
        inWorkspace = (argv) =>
          withSshHost(["docker", "exec", "-w", cwd, session, ...argv], config.zerg.sshHost);
      } else {
        failure =
          "Unable to prepare the local repository. Check featureChannels.localReposDir and repository access, then retry.";
        const local = await ensureLocalRepo({
          repo: repository,
          reposDir: config.featureChannels.localReposDir,
          exec,
        });
        cwd = path.join(path.dirname(local.repoPath), ".shade-worktrees", slug);
        await fs.mkdir(path.dirname(cwd), {recursive: true});
        // origin/HEAD identifies the default branch; do not fork a dirty/current feature branch.
        await checked(
          [
            "git",
            "-C",
            local.repoPath,
            "worktree",
            "add",
            "-b",
            slug,
            cwd,
            "refs/remotes/origin/HEAD",
          ],
          "Unable to create the feature worktree. Check origin/HEAD and branch/worktree conflicts, then retry."
        );
        workspace = {kind: "local", repoPath: cwd};
        inWorkspace = (argv) => [
          "sh",
          "-c",
          `cd ${shellQuote(cwd)} && exec ${argv.map(shellQuote).join(" ")}`,
        ];
      }
      const agents = config.brewery.agents.trim() ? ["--agents", config.brewery.agents] : [];
      const report = await checked(
        inWorkspace([config.brewery.command, "agents", ...agents]),
        "Brewery preflight failed. Install brewery in the workspace and check AppConfig.brewery.command and agents, then retry."
      );
      verifyAgents(report);
      const runDir = path.posix.join(".terreno", "brewery", slug);
      const requestFile = path.posix.join(runDir, "request.md");
      const logFile = path.posix.join(runDir, "launch.log");
      if (workspace.kind === "local") {
        await fs.mkdir(path.join(cwd, runDir), {recursive: true});
        await fs.writeFile(path.join(cwd, requestFile), request, {mode: 0o600});
      } else {
        await checked(
          inWorkspace([
            "sh",
            "-c",
            `umask 077; mkdir -p ${shellQuote(runDir)} && printf %s ${shellQuote(request)} > ${shellQuote(requestFile)}`,
          ]),
          "Unable to write the brewery request in zerg. Check workspace permissions, then retry."
        );
      }
      feature.brewery = {
        slug,
        repo: repository,
        workspace,
        phase: "distill",
        eventsOffset: 0,
        stepMessages: [],
      };
      feature.status = "in_progress";
      feature.startedAt = new Date();
      feature.errorMessage = undefined;
      await feature.save();
      const argv = [
        config.brewery.command,
        "distill",
        "--file",
        requestFile,
        "--slug",
        slug,
        "--no-wait",
        ...agents,
      ];
      failure = `Unable to launch brewery. Check the workspace executable and ${logFile}, then retry.`;
      if (workspace.kind === "local") {
        await (this.options.launch ?? launchDetached)(argv, cwd, path.join(cwd, logFile));
      } else {
        await checked(
          withSshHost(
            [
              "docker",
              "exec",
              "-d",
              "-w",
              cwd,
              workspace.session,
              "sh",
              "-c",
              `umask 077; exec ${argv.map(shellQuote).join(" ")} >> ${shellQuote(logFile)} 2>&1`,
            ],
            config.zerg.sshHost
          ),
          failure
        );
      }
      return feature.brewery;
    } catch (error) {
      // Only our actionable errors reach the channel; OS output may contain credentials/request text.
      const message = error instanceof StartupError ? error.message : failure;
      feature.status = "error";
      feature.errorMessage = message;
      await feature.save();
      await this.options.sendMessage(
        String(group.channelId),
        group.externalId,
        `Brewery could not start: ${message}`
      );
      throw new StartupError(message);
    }
  }
}
