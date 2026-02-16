import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {config} from "../config";

const MEMORY_FILENAME = "CLAUDE.md";

export const getGlobalMemoryPath = (): string => {
  return path.join(config.paths.groups, MEMORY_FILENAME);
};

export const getGroupMemoryPath = (groupFolder: string): string => {
  return path.join(config.paths.groups, groupFolder, MEMORY_FILENAME);
};

export const readMemory = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
};

export const writeMemory = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  await fs.writeFile(filePath, content, "utf-8");
  logger.debug(`Memory written to ${filePath}`);
};

export const ensureGroupDirectory = async (groupFolder: string): Promise<string> => {
  const groupDir = path.join(config.paths.groups, groupFolder);
  await fs.mkdir(groupDir, {recursive: true});
  return groupDir;
};

export const initGlobalMemory = async (): Promise<void> => {
  const globalPath = getGlobalMemoryPath();
  const existing = await readMemory(globalPath);
  if (existing === null) {
    await writeMemory(
      globalPath,
      `# Shade Global Memory\n\nThis file is shared across all groups. The main group can edit it.\n`
    );
    logger.info("Global CLAUDE.md initialized");
  }
};

export const canWriteGlobalMemory = (isMainGroup: boolean): boolean => {
  return isMainGroup;
};

export const canWriteGroupMemory = (
  groupFolder: string,
  requestingGroupFolder: string
): boolean => {
  return groupFolder === requestingGroupFolder;
};
