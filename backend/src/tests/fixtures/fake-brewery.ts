/** External CLI boundary for the HTTP harness. Never invokes an agent or a network API. */
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];
const option = (name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1]!;
};
if (command === "agents") {
  process.stdout.write("Agents:\n  ✓ fake command\nStages:\n");
  for (const stage of ["distill", "cut", "pick", "roast", "review", "brew", "taste"]) {
    process.stdout.write(`  ${stage} first of fake\n`);
  }
  process.exit(0);
}
if (command !== "distill" && command !== "answer") throw new Error("Unexpected command");
if (!args.includes("--no-wait")) throw new Error("Expected --no-wait");
const slug = command === "distill" ? option("--slug") : args[1]!;
const runDir = path.join(process.cwd(), ".terreno/brewery", slug);
const emit = async (event: Record<string, unknown>) => {
  await fs.appendFile(
    path.join(runDir, "events.jsonl"),
    `${JSON.stringify({t: new Date().toISOString(), ...event})}\n`
  );
};
const phase = async (value: string) => {
  await fs.writeFile(path.join(runDir, "state.json"), JSON.stringify({phase: value}));
};
await fs.writeFile(path.join(runDir, "run.pid"), String(process.pid));
try {
  await fs.appendFile(path.join(runDir, "invocations.jsonl"), `${JSON.stringify(args)}\n`);
  if (command === "distill") {
    const request = await fs.readFile(option("--file"), "utf8");
    if (request === "Simulate brewery failure") {
      await phase("error");
      await emit({kind: "error", message: "Fake brewery failed deliberately"});
    } else {
      await fs.mkdir("docs", {recursive: true});
      await fs.writeFile(
        "docs/fixture-plan.md",
        "# Fixture plan\n\n## Summary\nAdd a quiet reading room.\n\n## Tasks\n- [ ] T1 Add the reading room\n"
      );
      await emit({kind: "step.start", seq: 1, stage: "distill", agent: "fake"});
      await emit({
        kind: "step.end",
        seq: 1,
        status: "PASS",
        action: "Approve the plan",
        seconds: 1,
      });
      await phase("signoff");
      await emit({
        kind: "waiting",
        waitingKind: "signoff",
        message: "Review the reading room plan",
        ip: "docs/fixture-plan.md",
      });
    }
  } else {
    if (args[2] !== "ok" || !args.includes("--go") || option("--repo") !== process.cwd()) {
      throw new Error("Expected an approved answer in the saved workspace");
    }
    await phase("build");
    await emit({kind: "resumed"});
    await emit({kind: "step.start", seq: 2, stage: "pick", task: "T1", agent: "fake"});
    await emit({kind: "narration", seq: 2, text: "Building the quiet reading room"});
    // Let the test observe a live edit before completing, with a bounded lifetime on failure.
    const deadline = Date.now() + 20000;
    while (!(await fs.exists(path.join(runDir, "finish")))) {
      if (Date.now() > deadline) throw new Error("Harness did not release completion");
      await Bun.sleep(25);
    }
    await emit({
      kind: "step.end",
      seq: 2,
      status: "PASS",
      action: "Reading room ready",
      seconds: 2,
    });
    await emit({kind: "pr", number: 42, url: "https://example.invalid/reading-room/pull/42"});
    await phase("done");
    await emit({kind: "done"});
  }
} finally {
  await fs.rm(path.join(runDir, "run.pid"), {force: true});
}
