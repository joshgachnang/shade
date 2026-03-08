import {modelRouter, Permissions} from "@terreno/api";
import {Plugin} from "../models";

export const pluginRoutes = modelRouter("/plugins", Plugin, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["enabled"],
  sort: "name",
});
