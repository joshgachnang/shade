import {modelRouter, Permissions} from "@terreno/api";
import {User} from "../models";

export const userRoutes = modelRouter("/users", User, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["email", "name"],
  sort: "name",
});
