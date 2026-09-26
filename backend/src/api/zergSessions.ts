import type {TerrenoPlugin} from "@terreno/api";
import {asyncHandler, authenticateMiddleware} from "@terreno/api";
import type {Request, Response} from "express";
import {getZergSessionsService} from "../orchestrator/services/zergSessions";

/**
 * Zerg sessions dashboard (IP-017).
 *
 * GET /zerg/sessions?refresh=1&repo=<name> — every zerg session with activity,
 * stage, PR, blocked-on, plus pending inbox items and the drone count.
 * Read-only; there is no POST. zerg being unreachable is a 200 with `error`
 * set (and the last known rows when there are any) so the screen can show a
 * banner instead of an empty page.
 */
/** Query-string → service options. Exported for tests. */
export const parseZergSessionsQuery = (
  query: Record<string, unknown>
): {refresh: boolean; repo?: string} => {
  const refreshParam = query.refresh;
  const refresh = refreshParam === "1" || refreshParam === "true";
  const repoParam = query.repo;
  const repo = typeof repoParam === "string" && repoParam.trim() ? repoParam.trim() : undefined;
  return {refresh, repo};
};

export class ZergSessionsPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    app.get(
      "/zerg/sessions",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const dashboard = await getZergSessionsService().getDashboard(
          parseZergSessionsQuery(req.query as Record<string, unknown>)
        );
        res.json(dashboard);
      })
    );
  }
}
