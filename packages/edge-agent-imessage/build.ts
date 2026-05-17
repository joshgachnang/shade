#!/usr/bin/env bun

import os from "node:os";

const platform = os.platform();
const arch = os.arch();

const targets: Array<{target: string; output: string}> = [
  {target: `bun-${platform}-${arch}`, output: `shade-imessage-${platform}-${arch}`},
];

// Allow cross-compilation via CLI args
const requestedTarget = process.argv[2];
if (requestedTarget) {
  targets.length = 0;
  targets.push({target: requestedTarget, output: `shade-imessage-${requestedTarget}`});
}

for (const {target, output} of targets) {
  console.info(`Building ${output} (target: ${target})...`);

  const result = Bun.spawnSync([
    "bun",
    "build",
    "--compile",
    "--minify",
    "--bytecode",
    "--target",
    target,
    "src/index.ts",
    "--outfile",
    `dist/${output}`,
  ]);

  if (result.exitCode !== 0) {
    console.error(`Build failed for ${target}:`);
    console.error(result.stderr.toString());
    process.exit(1);
  }

  console.info(`Built: dist/${output}`);
}

console.info("Build complete");
