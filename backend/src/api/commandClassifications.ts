import {modelRouter, Permissions} from "@terreno/api";
import {CommandClassification} from "../models";

export const commandClassificationRoutes = modelRouter(
  "/commandClassifications",
  CommandClassification,
  {
    permissions: {
      create: [Permissions.IsAdmin],
      delete: [Permissions.IsAdmin],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsAuthenticated],
      update: [Permissions.IsAdmin],
    },
    queryFields: ["classification"],
    sort: "-priority",
  }
);
