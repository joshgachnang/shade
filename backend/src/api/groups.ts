import {modelRouter, Permissions} from "@terreno/api";
import {Group} from "../models";

export const groupRoutes = modelRouter("/groups", Group, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["channelId", "isMain", "name"],
  sort: "name",
});
