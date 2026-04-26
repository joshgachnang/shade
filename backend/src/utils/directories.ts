import fs from "node:fs/promises";
import {logger} from "@terreno/api";
import {paths} from "../config";

export const initDirectories = async (): Promise<void> => {
  const dirs = [paths.groups, paths.sessions, paths.ipc, paths.plugins, paths.movies];

  for (const dir of dirs) {
    await fs.mkdir(dir, {recursive: true});
  }

  logger.info("Data directories initialized");
};
