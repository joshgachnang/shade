import type {TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {getOrchestrator} from "../orchestrator";

export class HealthPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.get("/health", (_req, res) => {
      res.json({status: "ok"});
    });

    // Liveness of inbound channels (Slack socket-mode, etc.) for the watchdog.
    // Returns 503 when any Slack channel is unhealthy so generic monitors can
    // alert, while always including a parseable body.
    app.get("/health/slack", (_req, res) => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) {
        res.status(503).json({healthy: false, detail: "orchestrator not running", channels: []});
        return;
      }

      const channels = orchestrator.channelManager.getHealthSnapshot();
      const slackChannels = channels.filter((c) => c.type === "slack");
      // Healthy when every Slack channel is live. No Slack channels → nothing to watch.
      const healthy = slackChannels.every((c) => c.healthy);

      res.status(healthy ? 200 : 503).json({
        healthy,
        checkedAt: new Date().toISOString(),
        channels,
      });
    });
  }
}
