import {modelRouter, Permissions} from "@terreno/api";
import {EdgeAgent} from "../models";

export const edgeAgentRoutes = modelRouter("/edgeAgents", EdgeAgent, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["status", "agentType", "platform"],
  sort: "name",
});
