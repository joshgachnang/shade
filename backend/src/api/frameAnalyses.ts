import {modelRouter, Permissions} from "@terreno/api";
import {FrameAnalysis} from "../models";

export const frameAnalysisRoutes = modelRouter("/frameAnalyses", FrameAnalysis, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["movieId", "frameId"],
  sort: "timestamp",
});
