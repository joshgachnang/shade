import {modelRouter, Permissions} from "@terreno/api";
import {RemoteAgent} from "../models";

export const remoteAgentRoutes = modelRouter("/remoteAgents", RemoteAgent, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["status", "capabilities"],
  sort: "name",
});
