import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../config";

const MEMORY_FILENAME = "CLAUDE.md";
const SOUL_FILENAME = "SOUL.md";

export const getSoulPath = (): string => {
  return path.join(paths.groups, SOUL_FILENAME);
};

export const getGlobalMemoryPath = (): string => {
  return path.join(paths.groups, MEMORY_FILENAME);
};

export const getGroupMemoryPath = (groupFolder: string): string => {
  return path.join(paths.groups, groupFolder, MEMORY_FILENAME);
};

export const readMemory = async (filePath: string): Promise<string | null> => {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    logger.debug(`Memory read from ${filePath} (${content.length} chars)`);
    return content;
  } catch {
    logger.debug(`Memory file not found: ${filePath}`);
    return null;
  }
};

export const writeMemory = async (filePath: string, content: string): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content, "utf-8");
    logger.debug(`Memory written to ${filePath} (${content.length} chars)`);
  } catch (err) {
    logger.error(`Failed to write memory to ${filePath}: ${err}`);
    throw err;
  }
};

export const ensureGroupDirectory = async (groupFolder: string): Promise<string> => {
  const groupDir = path.join(paths.groups, groupFolder);
  try {
    await fs.mkdir(groupDir, {recursive: true});
    logger.debug(`Group directory ensured: ${groupDir}`);
  } catch (err) {
    logger.error(`Failed to create group directory ${groupDir}: ${err}`);
    throw err;
  }
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
  } else {
    logger.debug("Global CLAUDE.md already exists");
  }
};

export const buildSystemPrompt = async (groupFolder: string, fallback: string): Promise<string> => {
  const parts: string[] = [];

  const soul = await readMemory(getSoulPath());
  if (soul) {
    parts.push(soul);
  }

  const globalMemory = await readMemory(getGlobalMemoryPath());
  if (globalMemory) {
    parts.push(globalMemory);
  }

  const groupMemory = await readMemory(getGroupMemoryPath(groupFolder));
  if (groupMemory) {
    parts.push(groupMemory);
  }

  if (parts.length === 0) {
    parts.push(fallback);
  }

  return parts.join("\n\n---\n\n");
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
