import {type ModelRouterOptions, modelRouter, Permissions} from "@terreno/api";
import type {Router} from "express";
import {Group} from "../models";
import type {GroupDocument} from "../types";

export const addGroupRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<GroupDocument>>
): void => {
  router.use(
    "/groups",
    modelRouter(Group, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["channelId", "isMain", "name"],
      sort: "name",
    })
  );
};
