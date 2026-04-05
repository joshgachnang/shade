/**
 * Load environment variables from shade-backend.env and backend/.env files.
 * Values are only set if not already present in process.env.
 */

import {homedir} from "node:os";
import {join} from "node:path";

export const loadEnvFiles = async (backendDir: string): Promise<void> => {
  const envFiles = [join(homedir(), ".config/shade/shade-backend.env"), join(backendDir, ".env")];

  for (const envPath of envFiles) {
    const envFile = Bun.file(envPath);
    if (await envFile.exists()) {
      const text = await envFile.text();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.slice(0, eqIndex).trim();
          const value = trimmed
            .slice(eqIndex + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  }
};
