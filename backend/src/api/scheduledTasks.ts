import {modelRouter, Permissions} from "@terreno/api";
import {ScheduledTask} from "../models";

export const scheduledTaskRoutes = modelRouter("/scheduledTasks", ScheduledTask, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["groupId", "status", "scheduleType", "classification"],
  sort: "-created",
});
