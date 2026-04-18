import path from "node:path";
import {modelRouter, Permissions, type TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {paths} from "../config";
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

export class RecordingsPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.get("/static/recordings/*", (req: express.Request, res: express.Response) => {
      const recordingsDir = path.join(paths.data, "recordings");
      const resolved = path.resolve(recordingsDir, (req.params as Record<string, string>)[0]);
      if (!resolved.startsWith(path.resolve(recordingsDir))) {
        res.status(403).json({error: "Forbidden"});
        return;
      }
      res.sendFile(resolved);
    });
  }
}
