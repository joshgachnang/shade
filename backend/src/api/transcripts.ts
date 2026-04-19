import path from "node:path";
import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {paths} from "../config";
import {serveStaticUnder} from "../utils/staticFiles";

export class RecordingsPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.get("/static/recordings/*", serveStaticUnder(path.join(paths.data, "recordings")));
  }
}
