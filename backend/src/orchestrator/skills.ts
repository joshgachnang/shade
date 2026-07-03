import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../config";

const SKILL_EXTENSION = ".md";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SkillSummary {
  name: string;
  description: string;
}

export interface SaveSkillParams {
  name: string;
  description: string;
  content: string;
  maxChars: number;
}

export interface SaveSkillResult {
  saved: boolean;
  error?: string;
}

export interface LoadSkillResult {
  found: boolean;
  content?: string;
  description?: string;
  validNames?: string[];
}

/**
 * Skill names must be kebab-case (lowercase letters, digits, hyphens). This
 * also guarantees names cannot contain path separators or `..`, so a skill
 * name can never escape the skills directory.
 */
export const isValidSkillName = (name: string): boolean => {
  return SKILL_NAME_PATTERN.test(name);
};

export const getSkillPath = (name: string): string => {
  return path.join(paths.skills, `${name}${SKILL_EXTENSION}`);
};

const serializeSkill = ({
  name,
  description,
  content,
}: {
  name: string;
  description: string;
  content: string;
}): string => {
  // Frontmatter values must stay on one line; collapse any stray newlines.
  const singleLineDescription = description.replace(/\s*\n\s*/g, " ").trim();
  return `---\nname: ${name}\ndescription: ${singleLineDescription}\n---\n${content}`;
};

/**
 * Parse the simple `---`-delimited frontmatter of a skill file. Returns the
 * frontmatter fields plus the body. Malformed files (missing or unclosed
 * frontmatter) fall back to an empty description with the whole file as body.
 */
const parseSkillFile = (raw: string): {description: string; body: string} => {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    return {description: "", body: raw};
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) {
    return {description: "", body: raw};
  }

  let description = "";
  for (const line of lines.slice(1, closingIndex)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key === "description") {
      description = line.slice(separatorIndex + 1).trim();
    }
  }

  return {description, body: lines.slice(closingIndex + 1).join("\n")};
};

/**
 * Write (or overwrite) a skill file at `paths.skills/<name>.md`. Validation
 * failures (bad name, over the char cap) return `{saved: false, error}` so
 * callers can surface the message without try/catch; filesystem errors throw.
 */
export const saveSkill = async ({
  name,
  description,
  content,
  maxChars,
}: SaveSkillParams): Promise<SaveSkillResult> => {
  if (!isValidSkillName(name)) {
    return {
      saved: false,
      error: `Invalid skill name "${name}". Use kebab-case: lowercase letters, digits, and hyphens (e.g. "check-plex-health").`,
    };
  }

  const serialized = serializeSkill({name, description, content});
  if (serialized.length > maxChars) {
    return {
      saved: false,
      error: `Skill "${name}" is ${serialized.length} characters, over the ${maxChars} character limit. Condense the content and try again.`,
    };
  }

  const filePath = getSkillPath(name);
  try {
    await fs.mkdir(paths.skills, {recursive: true});
    await fs.writeFile(filePath, serialized, "utf-8");
  } catch (err) {
    logger.error(`Failed to write skill ${name} to ${filePath}: ${err}`);
    throw err;
  }

  logger.info(`Skill saved: ${name} (${serialized.length} chars)`);
  return {saved: true};
};

/**
 * List all skills as `{name, description}`, parsing frontmatter only. The
 * filename (minus `.md`) is authoritative for the name. Files with malformed
 * frontmatter get an empty description; a missing skills directory yields an
 * empty list.
 */
export const listSkills = async (): Promise<SkillSummary[]> => {
  let entries: string[];
  try {
    entries = await fs.readdir(paths.skills);
  } catch {
    logger.debug(`Skills directory not found: ${paths.skills}`);
    return [];
  }

  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(SKILL_EXTENSION)) {
      continue;
    }
    const name = entry.slice(0, -SKILL_EXTENSION.length);
    if (!isValidSkillName(name)) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(paths.skills, entry), "utf-8");
      const {description} = parseSkillFile(raw);
      skills.push({name, description});
    } catch (err) {
      logger.warn(`Skipping unreadable skill file ${entry}: ${err}`);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Load a skill's full body by name. Invalid or unknown names return
 * `{found: false, validNames}` so callers can report "not found" along with
 * the available skills. Malformed frontmatter falls back to returning the
 * whole file as the body.
 */
export const loadSkill = async ({name}: {name: string}): Promise<LoadSkillResult> => {
  const notFound = async (): Promise<LoadSkillResult> => {
    const skills = await listSkills();
    return {found: false, validNames: skills.map((skill) => skill.name)};
  };

  if (!isValidSkillName(name)) {
    return notFound();
  }

  let raw: string;
  try {
    raw = await fs.readFile(getSkillPath(name), "utf-8");
  } catch {
    return notFound();
  }

  const {description, body} = parseSkillFile(raw);
  return {found: true, content: body, description};
};
