import fs from "node:fs/promises";
import {logger} from "@terreno/api";
import {config} from "../config";

export const initDirectories = async (): Promise<void> => {
  const dirs = [config.paths.groups, config.paths.sessions, config.paths.ipc, config.paths.plugins];

  for (const dir of dirs) {
    await fs.mkdir(dir, {recursive: true});
  }

  logger.info("Data directories initialized");
};
