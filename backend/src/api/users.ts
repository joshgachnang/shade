import { type ModelRouterOptions, modelRouter, Permissions } from "@terreno/api";
import type { Router } from "express";
import { User } from "../models";
import type { UserDocument } from "../types";

export const addUserRoutes = ({
  router,
  options,
}: {
  router: Router;
  options?: Partial<ModelRouterOptions<UserDocument>>;
}): void => {
  router.use(
    "/users",
    modelRouter(User, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["email", "name"],
      sort: "name",
    }),
  );
};
