import {modelRouter, Permissions} from "@terreno/api";
import {Transcript} from "../models";

export const transcriptRoutes = modelRouter("/transcripts", Transcript, {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAdmin],
  },
  queryFields: ["radioStreamId", "targetGroupId"],
  sort: "-created",
});
