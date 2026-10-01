import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {loadAppConfig} from "../../models/appConfig";
import {Feature} from "../../models/feature";
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

  async handleMessage(
    group: GroupDocument,
    message: {content: string}
  ): Promise<undefined | "deferred"> {
    const post = async (text: string) =>
      this.options.sendMessage(String(group.channelId), group.externalId, text);
    const text = message.content;
    const command = text.trim();
    if (!command) {
      await post("Send a reply, a note, `now: <text>`, `stop`, or `resume`.");
      return;
    }
    if (/^now:\s*$/i.test(command)) {
      await post("Add a note after `now:` before interrupting brewery.");
      return;
    }
    const feature = await Feature.findOneOrNone({groupId: group._id, brewery: {$exists: true}});
    if (!feature?.brewery) {
      await post("No brewery run exists for this feature channel. Start a feature first.");
      return;
    }
    const state = feature.brewery;
    const config = await (this.options.loadConfig ?? loadAppConfig)();
    // Share the poller's lease so it cannot overwrite a stop with a stale event snapshot.
    const lease = new Date(Date.now() + config.zerg.upTimeoutMs * 4);
    const claimed = await Feature.findOneAndUpdate(
      {
        _id: feature._id,
        $or: [
          {"brewery.pollLeaseUntil": {$exists: false}},
          {"brewery.pollLeaseUntil": {$lte: new Date()}},
        ],
      },
      {$set: {"brewery.pollLeaseUntil": lease}},
      {new: true}
    );
    if (!claimed) {
      await post(
        "Brewery is processing an update. Your reply is queued and will retry automatically."
      );
      return "deferred";
    }
    const workspace = state.workspace;
    const cwd = workspace.kind === "local" ? workspace.repoPath : config.zerg.workdir;
    const runDir = path.posix.join(".terreno/brewery", state.slug);
    const logFile = path.posix.join(runDir, "launch.log");
    const inWorkspace = (argv: string[]) =>
      workspace.kind === "local"
        ? ["sh", "-c", `cd ${shellQuote(cwd)} && exec ${argv.map(shellQuote).join(" ")}`]
        : withSshHost(
            ["docker", "exec", "-w", cwd, workspace.session, ...argv],
            config.zerg.sshHost
          );
    const checked = async (argv: string[]) => {
      const result = await (this.options.exec ?? defaultExec)(argv, {
        timeoutMs: config.zerg.upTimeoutMs,
      });
      if (result.code !== 0) throw new Error("Brewery command failed");
    };
    const cli = (args: string[]) => [
      config.brewery.command,
      ...args,
      "--repo",
      cwd,
      ...(config.brewery.agents.trim() ? ["--agents", config.brewery.agents] : []),
    ];
    const launch = async (args: string[]) => {
      const argv = cli(args);
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
              `umask 077; exec setsid ${argv.map(shellQuote).join(" ")} >> ${shellQuote(logFile)} 2>&1`,
            ],
            config.zerg.sshHost
          )
        );
      }
    };
    const stop = async () => {
      // Run inside the workspace's PID namespace. Missing/dead owners are already stopped;
      // invalid PIDs and permission errors must not be treated as successful cancellation.
      await checked(
        inWorkspace([
          "bun",
          "-e",
          `
        const fs = require("node:fs");
        const file = process.argv[1];
        if (!fs.existsSync(file)) process.exit(0);
        const raw = fs.readFileSync(file, "utf8").trim();
        const pid = Number(raw);
        if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(pid) || pid <= 1) process.exit(1);
        const signal = (sig) => {
          try { process.kill(-pid, sig); return true; }
          catch (e) { if (e.code === "ESRCH") return false; throw e; }
        };
        if (!signal("SIGTERM")) {
          try { process.kill(pid, 0); process.exit(1); }
          catch (e) { if (e.code === "ESRCH") process.exit(0); throw e; }
        }
        const deadline = Date.now() + Number(process.argv[2]);
        while (Date.now() < deadline) {
          try { process.kill(pid, 0); }
          catch (e) { if (e.code === "ESRCH") { signal("SIGKILL"); process.exit(0); } throw e; }
          await Bun.sleep(25);
        }
        signal("SIGKILL");
        while (true) {
          try { process.kill(pid, 0); }
          catch (e) { if (e.code === "ESRCH") { signal("SIGKILL"); process.exit(0); } throw e; }
          await Bun.sleep(25);
        }
      `,
          `${runDir}/run.pid`,
          String(config.zerg.upTimeoutMs / 2),
        ])
      );
    };
    try {
      const latest = await Feature.findById(feature._id);
      if (!latest?.brewery) throw new Error("Missing run");
      const current =
        [...latest.brewery.stepMessages]
          .reverse()
          .find((step) => !step.final)
          ?.label?.replace(/ \([^)]*\)$/, "") ??
        latest.brewery.phase ??
        "startup";
      if (latest.status === "complete") {
        await post("This brewery run is complete. Start a new feature for more work.");
        return;
      }
      if (command.toLowerCase() === "stop") {
        await stop();
        await Feature.updateOne({_id: feature._id}, {$set: {status: "paused"}});
        await post("Brewery stopped. Reply `resume` to continue.");
        return;
      }
      if (/^now:/i.test(command)) {
        await stop();
        await checked(
          inWorkspace(cli(["note", state.slug, text.slice(text.toLowerCase().indexOf("now:") + 4)]))
        );
        await launch(["resume", state.slug, "--go", "--no-wait"]);
        await Feature.updateOne(
          {_id: feature._id},
          {
            $set: {status: "in_progress", "brewery.lastEventAt": new Date()},
            $unset: {errorMessage: 1},
          }
        );
        await post(`Interrupted ${current}; restarting with your note`);
      } else if (command.toLowerCase() === "resume") {
        await launch(["resume", state.slug, "--go", "--no-wait"]);
        await Feature.updateOne(
          {_id: feature._id},
          {
            $set: {status: "in_progress", "brewery.lastEventAt": new Date()},
            $unset: {errorMessage: 1},
          }
        );
        await post("Brewery resume requested.");
      } else if (latest.brewery.waiting) {
        // waiting is emitted before notification delivery finishes and the CLI
        // releases run.lock. Spawning answer then would lose the reply on lock contention.
        const owner = await (this.options.exec ?? defaultExec)(
          inWorkspace([
            "bun",
            "-e",
            `const fs = require("node:fs");
            const dir = process.argv[1];
            if (fs.existsSync(dir + "/run.guard")) process.exit(75);
            if (!fs.existsSync(dir + "/run.lock")) process.exit(0);
            let raw;
            try { raw = fs.readFileSync(dir + "/run.pid", "utf8").trim(); }
            catch (e) { if (e.code === "ENOENT") process.exit(75); throw e; }
            const pid = Number(raw);
            if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(pid) || pid <= 1) process.exit(1);
            try { process.kill(pid, 0); process.exit(75); }
            catch (e) { if (e.code === "ESRCH") process.exit(0); throw e; }`,
            runDir,
          ]),
          {timeoutMs: config.zerg.upTimeoutMs}
        );
        if (owner.code === 75) {
          await post(
            "Brewery is processing an update. Your reply is queued and will retry automatically."
          );
          return "deferred";
        }
        if (owner.code !== 0) throw new Error("Unable to check brewery run owner");
        await launch(["answer", state.slug, text, "--go", "--no-wait"]);
        // Keep waiting until the CLI's resumed event confirms the answer was accepted.
        await Feature.updateOne(
          {_id: feature._id},
          {
            $set: {status: "in_progress", "brewery.lastEventAt": new Date()},
            $unset: {errorMessage: 1},
          }
        );
        await post("Reply sent to brewery.");
      } else {
        await checked(inWorkspace(cli(["note", state.slug, text])));
        await post(`Queued for the next check-in (current: ${current})`);
      }
    } catch {
      const failure = `Brewery could not process the reply. Check workspace access and ${logFile}, then retry or reply \`resume\`.`;
      await Feature.updateOne({_id: feature._id}, {$set: {status: "error", errorMessage: failure}});
      await post(failure);
    } finally {
      await Feature.updateOne(
        {_id: feature._id, "brewery.pollLeaseUntil": lease},
        {$unset: {"brewery.pollLeaseUntil": 1}}
      );
    }
  }

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
              `umask 077; exec setsid ${argv.map(shellQuote).join(" ")} >> ${shellQuote(logFile)} 2>&1`,
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
