import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { Message } from "../models";
import type { MessageDocument } from "../types";

export const addMessageRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<MessageDocument>>,
): void => {
  router.use(
    "/messages",
    modelRouter(Message, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["groupId", "isFromBot", "processedAt"],
      sort: "-created",
    }),
  );
};
