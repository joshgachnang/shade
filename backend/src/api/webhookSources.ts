import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { WebhookSource } from "../models";
import type { WebhookSourceDocument } from "../types";

export const addWebhookSourceRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<WebhookSourceDocument>>,
): void => {
  router.use(
    "/webhookSources",
    modelRouter(WebhookSource, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["type", "groupId", "enabled", "classification"],
      sort: "name",
    }),
  );
};
