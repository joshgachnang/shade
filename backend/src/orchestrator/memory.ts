import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../config";
import {loadAppConfig} from "../models/appConfig";
import {memorySystemPromptBlock} from "./memoryPromptBlock";
import {richResponseSystemPromptBlock} from "./responses/promptBlock";
import {listSkills} from "./skills";

const MEMORY_FILENAME = "CLAUDE.md";
const SOUL_FILENAME = "SOUL.md";
const USER_FILENAME = "USER.md";

export const getSoulPath = (): string => {
  return path.join(paths.groups, SOUL_FILENAME);
};

export const getGlobalMemoryPath = (): string => {
  return path.join(paths.groups, MEMORY_FILENAME);
};

export const getUserProfilePath = (): string => {
  return path.join(paths.groups, USER_FILENAME);
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

export interface MemoryUpdateResult {
  ok: boolean;
  size: number;
  error?: string;
}

/**
 * Apply an update to a memory file, enforcing a character cap on the
 * resulting content. `append` joins existing content (if any) with a newline;
 * `replace` overwrites. Nothing is written when the cap would be exceeded.
 */
export const applyMemoryUpdate = async ({
  filePath,
  content,
  mode,
  maxChars,
}: {
  filePath: string;
  content: string;
  mode: "replace" | "append";
  maxChars: number;
}): Promise<MemoryUpdateResult> => {
  const existing = mode === "append" ? await readMemory(filePath) : null;
  const resulting = existing ? `${existing}\n${content}` : content;

  if (resulting.length > maxChars) {
    return {
      ok: false,
      size: resulting.length,
      error: `Resulting file would be ${resulting.length} characters, over the ${maxChars} character limit. Condense the content and try again — nothing was written.`,
    };
  }

  await writeMemory(filePath, resulting);
  return {ok: true, size: resulting.length};
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
  const appConfig = await loadAppConfig();
  const memoryEnabled = appConfig.memory?.enabled ?? true;

  const soul = await readMemory(getSoulPath());
  if (soul) {
    parts.push(soul);
  }

  if (memoryEnabled) {
    const userProfile = await readMemory(getUserProfilePath());
    if (userProfile) {
      parts.push(userProfile);
    }
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

  // Append the rich-response prompt block when the feature flag is enabled.
  const richBlock = richResponseSystemPromptBlock({
    enabled: appConfig.richResponses?.enabled ?? true,
  });
  if (richBlock) {
    parts.push(richBlock);
  }

  // Teach the agent when to use memory/skills tools, then list the available
  // skills (index only — bodies stay on disk until load_skill is called).
  const memoryBlock = memorySystemPromptBlock({enabled: memoryEnabled});
  if (memoryBlock) {
    parts.push(memoryBlock);
  }

  if (memoryEnabled) {
    const skills = await listSkills();
    if (skills.length > 0) {
      const skillLines = skills.map((skill) => `- ${skill.name} — ${skill.description}`);
      parts.push(
        [
          "## Skills",
          "",
          "Saved skills (reusable procedures you authored). This index shows names and",
          "descriptions only — call `load_skill` before using one.",
          "",
          ...skillLines,
        ].join("\n")
      );
    }
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
