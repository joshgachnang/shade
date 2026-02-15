import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { AgentSession } from "../models";
import type { AgentSessionDocument } from "../types";

export const addAgentSessionRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<AgentSessionDocument>>,
): void => {
  router.use(
    "/agentSessions",
    modelRouter(AgentSession, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["groupId", "status"],
      sort: "-lastActivityAt",
    }),
  );
};
