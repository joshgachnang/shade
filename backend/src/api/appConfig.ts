import {modelRouter, Permissions} from "@terreno/api";
import {AppConfig} from "../models/appConfig";

export const appConfigRoutes = modelRouter("/app-configs", AppConfig, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: [],
  sort: "-created",
});
