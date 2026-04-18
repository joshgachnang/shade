import {modelRouter, Permissions} from "@terreno/api";
import {Character} from "../models";

export const characterRoutes = modelRouter("/characters", Character, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["movieId", "name"],
  sort: "name",
});
