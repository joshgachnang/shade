import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { Plugin } from "../models";
import type { PluginDocument } from "../types";

export const addPluginRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<PluginDocument>>,
): void => {
  router.use(
    "/plugins",
    modelRouter(Plugin, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["enabled"],
      sort: "name",
    }),
  );
};
