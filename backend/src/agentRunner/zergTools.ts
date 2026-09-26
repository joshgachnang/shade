import {tool} from "@anthropic-ai/claude-agent-sdk";
import {z} from "zod";
import {loadAppConfig} from "../models/appConfig";
import {formatDashboardText, getZergSessionsService} from "../orchestrator/services/zergSessions";

const text = (s: string) => ({content: [{type: "text" as const, text: s}]});
const errorText = (s: string) => ({content: [{type: "text" as const, text: s}], isError: true});

const DISABLED_TEXT = "zerg is disabled (AppConfig.zerg.enabled = false).";

/**
 * Read-only orchestrator view over zerg (IP-017). One tool: what is running,
 * what stage each drone is at, and what is waiting on a human. There is
 * deliberately no write tool here — answering, approving, killing stay in
 * zerg's own interface.
 */
export const buildZergTools = () => {
  const listZergSessionsTool = tool(
    "list_zerg_sessions",
    "List every zerg session (sandboxed agent container) with its activity (working/blocked/idle/dead), " +
      "drone stage, PR, what it is blocked on, its last output line, plus pending inbox items that need a " +
      'human decision and the running-drone count. Use this for questions like "what\'s running?", ' +
      '"what\'s waiting on me?", or before starting new work on a repo. Read-only.',
    {
      repo: z.string().optional().describe("Only sessions for this zerg repo name"),
      needsYouOnly: z
        .boolean()
        .optional()
        .describe("Only sessions that need a human (blocked, idle, dead) — default false"),
      refresh: z
        .boolean()
        .optional()
        .describe("Bypass the short cache and ask zerg again — default false"),
    },
    async (args) => {
      try {
        const {zerg} = await loadAppConfig();
        if (!zerg.enabled) {
          return errorText(DISABLED_TEXT);
        }
        const dashboard = await getZergSessionsService().getDashboard({
          repo: args.repo?.trim() || undefined,
          refresh: args.refresh === true,
        });
        return text(formatDashboardText(dashboard, {needsYouOnly: args.needsYouOnly === true}));
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return errorText(`Error listing zerg sessions: ${msg}`);
      }
    }
  );

  return [listZergSessionsTool];
};
