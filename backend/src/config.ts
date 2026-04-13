import path from "node:path";

const dataDir = process.env.SHADE_DATA_DIR || path.join(process.cwd(), "data");

/**
 * Static filesystem paths — these don't belong in the database.
 * All other runtime configuration lives in the AppConfig model.
 */
export const paths = {
  data: dataDir,
  groups: path.join(dataDir, "groups"),
  sessions: path.join(dataDir, "sessions"),
  ipc: path.join(dataDir, "ipc"),
  plugins: path.join(dataDir, "plugins"),
  movies: path.join(dataDir, "movies"),
};
