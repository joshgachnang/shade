import {type ModelRouterOptions, modelRouter, Permissions} from "@terreno/api";
import type {Router} from "express";
import {TaskRunLog} from "../models";
import type {TaskRunLogDocument} from "../types";

export const addTaskRunLogRoutes = (
  router: Router,
  options?: Partial<ModelRouterOptions<TaskRunLogDocument>>
): void => {
  router.use(
    "/taskRunLogs",
    modelRouter(TaskRunLog, {
      ...options,
      permissions: {
        create: [Permissions.IsAdmin],
        delete: [Permissions.IsAdmin],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAdmin],
      },
      queryFields: ["groupId", "taskId", "trigger", "status", "modelBackend"],
      sort: "-startedAt",
    })
  );
};
