import {type ModelRouterOptions, modelRouter, Permissions} from "@terreno/api";
import type {Router} from "express";
import {ScheduledTask} from "../models";
import type {ScheduledTaskDocument} from "../types";

export const addScheduledTaskRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<ScheduledTaskDocument>>
): void => {
  router.use(
    "/scheduledTasks",
    modelRouter(ScheduledTask, {
      ...options,
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAuthenticated],
      },
      queryFields: ["groupId", "status", "scheduleType", "classification"],
      sort: "-created",
    })
  );
};
