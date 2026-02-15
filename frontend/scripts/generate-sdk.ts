#!/usr/bin/env bun

import {exec} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const cliPath = join(
  __dirname,
  "..",
  "node_modules",
  "@rtk-query",
  "codegen-openapi",
  "lib",
  "bin",
  "cli.mjs"
);
const configPath = join(__dirname, "..", "openapi-config.ts");
const tsConfigPath = join(__dirname, "..", "tsconfig.codegen.json");

const command = `TS_NODE_PROJECT=${tsConfigPath} tsx ${cliPath} ${configPath}`;

exec(command, (error, _stdout, stderr): void => {
  if (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
  }

  const sdkPath = join(__dirname, "..", "store", "openApiSdk.ts");

  if (existsSync(sdkPath)) {
    let content = readFileSync(sdkPath, "utf8");
    content = content.replace(/^export const \{\} = injectedRtkApi;\n?/m, "");
    writeFileSync(sdkPath, content, "utf8");
  }

  exec(
    "bunx biome check --unsafe --write store/openApiSdk.ts",
    {cwd: join(__dirname, "..")},
    (formatError): void => {
      if (formatError) {
        console.error(`Formatting error: ${formatError.message}`);
        process.exit(1);
      }
    }
  );
});
