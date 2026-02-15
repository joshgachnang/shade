import {type ModelRouterOptions, modelRouter, Permissions} from "@terreno/api";
import type {Router} from "express";
import {Channel} from "../models";
import type {ChannelDocument} from "../types";

export const addChannelRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<ChannelDocument>>
): void => {
  router.use(
    "/channels",
    modelRouter(Channel, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["type", "status"],
      sort: "name",
    })
  );
};
