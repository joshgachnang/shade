import {modelRouter, Permissions} from "@terreno/api";
import {TaskRunLog} from "../models";

export const taskRunLogRoutes = modelRouter("/taskRunLogs", TaskRunLog, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["groupId", "taskId", "trigger", "status", "modelBackend"],
  sort: "-startedAt",
});
