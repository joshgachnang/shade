/**
 * Unified Shade entrypoint. All services ship as one bundle (dist/shade.js);
 * SHADE_SERVICE selects which one this process runs:
 *
 *   backend  (default) — HTTP gateway: API, channels, orchestrator
 *   worker             — AgentTask board worker (workerMain.ts)
 *   imessage           — iMessage edge agent (reads chat.db, needs SHADE_URL
 *                        + SHADE_BOOTSTRAP_SECRET, macOS Full Disk Access)
 *
 * Dynamic imports keep the unselected services from initializing.
 */
export {};

const service = process.env.SHADE_SERVICE || "backend";

if (service === "backend") {
  await import("./server");
} else if (service === "worker") {
  await import("./workerMain");
} else if (service === "imessage") {
  const {IMessageEdgeAgent} = await import("@shade/edge-agent-imessage");
  const agent = new IMessageEdgeAgent();
  agent.run().catch((error) => {
    console.error(`Fatal: ${error}`);
    process.exit(1);
  });
} else {
  console.error(`Unknown SHADE_SERVICE "${service}" (expected backend, worker, or imessage)`);
  process.exit(1);
}
