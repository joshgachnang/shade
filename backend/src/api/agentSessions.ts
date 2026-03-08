import {modelRouter, Permissions} from "@terreno/api";
import {AgentSession} from "../models";

export const agentSessionRoutes = modelRouter("/agentSessions", AgentSession, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["groupId", "status"],
  sort: "-lastActivityAt",
});
