/**
 * Running one-shot commands on the zerg host (locally or over ssh). Shared by
 * the ZergAgentRunner and the sessions dashboard; kept free of runner imports
 * so neither side pulls the other in at module-evaluation time.
 */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a one-shot host command to completion. Injected in tests. */
export type ExecFn = (argv: string[], opts: {timeoutMs: number}) => Promise<ExecResult>;

/** POSIX single-quote quoting for argv that passes through a remote shell. */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Prefixes argv with an SSH hop when `sshHost` is set. ssh hands the remote
 * shell a single string, so every argument is quoted to survive the trip.
 */
export const withSshHost = (argv: string[], sshHost: string): string[] => {
  const host = sshHost.trim();
  if (!host) {
    return argv;
  }
  return ["ssh", "-T", "-o", "BatchMode=yes", host, argv.map(shellQuote).join(" ")];
};

/** Default one-shot exec through Bun.spawn with a hard timeout. */
export const defaultExec: ExecFn = async (argv, {timeoutMs}) => {
  const proc = Bun.spawn(argv, {stdin: "ignore", stdout: "pipe", stderr: "pipe"});
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      code,
      stdout,
      stderr: timedOut ? `${stderr}\n(timed out after ${timeoutMs}ms)` : stderr,
    };
  } finally {
    clearTimeout(timer);
  }
};
