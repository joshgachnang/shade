import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Shared IPC file writer used by every producer (the Shade MCP server's tools,
 * MockAgentRunner's scripted actions, worker result delivery). Writes to a tmp
 * file and renames atomically so `IpcWatcher.poll()` never reads a partial
 * file. Callers should pass `paths.ipc` (which honors `SHADE_DATA_DIR`) so the
 * writer and the watcher always agree on the directory.
 *
 * Kept dependency-free (node builtins only) so it can be imported from the
 * MCP server, runners, and IPC watcher without creating module cycles.
 */
export const writeIpcFile = async (
  ipcDir: string,
  data: Record<string, unknown>
): Promise<string> => {
  await fs.mkdir(ipcDir, {recursive: true});

  const fileId = randomUUID();
  const tmpPath = path.join(ipcDir, `${fileId}.tmp`);
  const finalPath = path.join(ipcDir, `${fileId}.json`);

  await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await fs.rename(tmpPath, finalPath);

  return fileId;
};
