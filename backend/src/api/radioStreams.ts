import {modelRouter, Permissions} from "@terreno/api";
import {RadioStream} from "../models";

export const radioStreamRoutes = modelRouter("/radioStreams", RadioStream, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["status", "targetGroupId"],
  sort: "-created",
});
