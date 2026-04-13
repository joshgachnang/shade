import {modelRouter, Permissions} from "@terreno/api";
import {Frame} from "../models";

export const frameRoutes = modelRouter("/frames", Frame, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["movieId", "status", "frameNumber"],
  sort: "timestamp",
});
