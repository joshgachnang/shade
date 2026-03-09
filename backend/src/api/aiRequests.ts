import {modelRouter, Permissions} from "@terreno/api";
import {AIRequest} from "../models";

export const aiRequestRoutes = modelRouter("/aiRequests", AIRequest, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["aiModel", "groupId", "requestType", "status", "sessionId"],
  sort: "-created",
});
