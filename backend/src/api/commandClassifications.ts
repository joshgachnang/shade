import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { CommandClassification } from "../models";
import type { CommandClassificationDocument } from "../types";

export const addCommandClassificationRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<CommandClassificationDocument>>,
): void => {
  router.use(
    "/commandClassifications",
    modelRouter(CommandClassification, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["classification"],
      sort: "-priority",
    }),
  );
};
