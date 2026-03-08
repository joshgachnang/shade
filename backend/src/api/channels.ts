import {modelRouter, Permissions} from "@terreno/api";
import {Channel} from "../models";

export const channelRoutes = modelRouter("/channels", Channel, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["type", "status"],
  sort: "name",
});
