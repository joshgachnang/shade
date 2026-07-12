import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

export type JxaRunner = (script: string) => Promise<string>;

const defaultRunJxa: JxaRunner = async (script: string): Promise<string> => {
  const {stdout} = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim();
};

// Injectable for testing
export let runJxa: JxaRunner = defaultRunJxa;
export const setRunJxa = (fn: JxaRunner): void => {
  runJxa = fn;
};
export const resetRunJxa = (): void => {
  runJxa = defaultRunJxa;
};
