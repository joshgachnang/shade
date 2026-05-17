import {modelRouter, Permissions} from "@terreno/api";
import {EdgeAgentEvent} from "../models";

export const edgeAgentEventRoutes = modelRouter("/edgeAgentEvents", EdgeAgentEvent, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["agentId", "eventType"],
  sort: "-created",
});
