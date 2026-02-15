import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { RemoteAgent } from "../models";
import type { RemoteAgentDocument } from "../types";

export const addRemoteAgentRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<RemoteAgentDocument>>,
): void => {
  router.use(
    "/remoteAgents",
    modelRouter(RemoteAgent, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["status", "capabilities"],
      sort: "name",
    }),
  );
};
