import {modelRouter, Permissions} from "@terreno/api";
import {Message} from "../models";

export const messageRoutes = modelRouter("/messages", Message, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["groupId", "isFromBot", "processedAt"],
  sort: "-created",
});
