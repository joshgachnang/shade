import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";

export class HealthPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.get("/health", (_req, res) => {
      res.json({status: "ok"});
    });
  }
}
