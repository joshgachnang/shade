import {modelRouter, Permissions} from "@terreno/api";
import {WebhookSource} from "../models";

export const webhookSourceRoutes = modelRouter("/webhookSources", WebhookSource, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["type", "groupId", "enabled", "classification"],
  sort: "name",
});
