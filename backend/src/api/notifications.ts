import {randomUUID} from "node:crypto";
import {WebClient} from "@slack/web-api";
import {APIError, asyncHandler, logger, type TerrenoPlugin} from "@terreno/api";
import type {NextFunction, Request, Response} from "express";
import {loadAppConfig} from "../models/appConfig";
import {Channel} from "../models/channel";

interface NtfyPayload {
  topic?: string;
  message?: string;
  title?: string;
  priority?: number;
  tags?: string[];
  click?: string;
}

interface NtfyResponse {
  id: string;
  time: number;
  expires: number;
  event: "message";
  topic: string;
  title?: string;
  message: string;
  priority?: number;
  tags?: string[];
  click?: string;
}

const PRIORITY_EMOJI: Record<number, string> = {
  5: ":rotating_light:",
  4: ":warning:",
  2: ":arrow_down_small:",
  1: ":small_blue_diamond:",
};

const readHeader = (req: Request, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = req.header(name);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const parsePriority = (raw: string | undefined): number | undefined => {
  if (!raw) {
    return undefined;
  }
  const lookup: Record<string, number> = {
    max: 5,
    urgent: 5,
    high: 4,
    default: 3,
    low: 2,
    min: 1,
  };
  const normalized = raw.trim().toLowerCase();
  if (lookup[normalized]) {
    return lookup[normalized];
  }
  const num = Number.parseInt(normalized, 10);
  if (Number.isFinite(num) && num >= 1 && num <= 5) {
    return num;
  }
  return undefined;
};

const parseTags = (raw: string | undefined): string[] | undefined => {
  if (!raw) {
    return undefined;
  }
  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tags.length > 0 ? tags : undefined;
};

const buildPayload = (req: Request): NtfyPayload => {
  const contentType = req.header("content-type") ?? "";

  // JSON body — pass fields straight through.
  if (contentType.includes("application/json") && req.body && typeof req.body === "object") {
    const body = req.body as Record<string, unknown>;
    return {
      topic: typeof body.topic === "string" ? body.topic : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      priority:
        typeof body.priority === "number"
          ? body.priority
          : parsePriority(String(body.priority ?? "")),
      tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t)) : undefined,
      click: typeof body.click === "string" ? body.click : undefined,
    };
  }

  // Plain text / unknown body — body is the message; metadata comes from headers.
  const message = typeof req.body === "string" ? req.body : "";
  return {
    message,
    title: readHeader(req, "x-title", "title", "t"),
    priority: parsePriority(readHeader(req, "x-priority", "priority", "p", "prio")),
    tags: parseTags(readHeader(req, "x-tags", "tags", "ta")),
    click: readHeader(req, "x-click", "click"),
  };
};

const formatSlackMessage = (payload: NtfyPayload): string => {
  const lines: string[] = [];
  const tagPrefix = (payload.tags ?? []).map((t) => `:${t}:`).join(" ");
  const priorityEmoji = payload.priority ? (PRIORITY_EMOJI[payload.priority] ?? "") : "";
  const decoration = [priorityEmoji, tagPrefix].filter(Boolean).join(" ");

  if (payload.title) {
    lines.push(decoration ? `${decoration} *${payload.title}*` : `*${payload.title}*`);
    if (payload.message) {
      lines.push(payload.message);
    }
  } else {
    const body = payload.message ?? "";
    lines.push(decoration ? `${decoration} ${body}`.trim() : body);
  }

  if (payload.click) {
    lines.push(`<${payload.click}|Open>`);
  }

  return lines.join("\n");
};

/**
 * ntfy.sh-compatible notification webhook.
 *
 * POST /webhooks/notifications
 *
 *   Plain text body:
 *     curl -d "Backup complete" -H "Title: Backup" -H "Tags: white_check_mark" \
 *       https://shade-api.nang.io/webhooks/notifications
 *
 *   JSON body:
 *     curl -H "Content-Type: application/json" \
 *       -d '{"message":"Backup complete","title":"Backup","priority":4,"tags":["warning"]}' \
 *       https://shade-api.nang.io/webhooks/notifications
 *
 * Forwards to the Slack channel configured in AppConfig.notifications.slackChannel.
 */
export class NotificationsPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    const handler = asyncHandler(async (req: Request, res: Response) => {
      const payload = buildPayload(req);

      if (!payload.message || payload.message.trim().length === 0) {
        throw new APIError({status: 400, title: "message is required"});
      }

      const config = await loadAppConfig();
      if (!config.notifications?.enabled) {
        throw new APIError({status: 503, title: "Notifications are disabled"});
      }

      const slackChannelName = config.notifications.slackChannel?.trim();
      if (!slackChannelName) {
        throw new APIError({
          status: 503,
          title: "No Slack channel configured for notifications",
        });
      }

      const slackChannelDoc = await Channel.findOne({type: "slack"});
      if (!slackChannelDoc) {
        throw new APIError({status: 503, title: "No Slack channel connected"});
      }

      const slackConfig = slackChannelDoc.config as {botToken?: string};
      if (!slackConfig.botToken) {
        throw new APIError({status: 503, title: "Slack bot token not configured"});
      }

      const text = formatSlackMessage(payload);
      const target = slackChannelName.startsWith("#") ? slackChannelName : `#${slackChannelName}`;

      try {
        const client = new WebClient(slackConfig.botToken);
        await client.chat.postMessage({channel: target, text});
      } catch (err) {
        logger.error(`Failed to send notification to Slack ${target}: ${err}`);
        throw new APIError({status: 502, title: "Failed to deliver notification to Slack"});
      }

      const now = Math.floor(Date.now() / 1000);
      const response: NtfyResponse = {
        id: randomUUID().replace(/-/g, "").slice(0, 12),
        time: now,
        expires: now + 12 * 60 * 60,
        event: "message",
        topic: payload.topic ?? "notifications",
        message: payload.message,
        ...(payload.title ? {title: payload.title} : {}),
        ...(payload.priority ? {priority: payload.priority} : {}),
        ...(payload.tags ? {tags: payload.tags} : {}),
        ...(payload.click ? {click: payload.click} : {}),
      };

      res.json(response);
    });

    // express.json() is registered globally by setupServer for application/json.
    // For ntfy.sh compatibility we also accept plain text bodies (`curl -d "msg"`),
    // which the global parser leaves untouched — read them off the raw request stream.
    const readTextBody = (req: Request, _res: Response, next: NextFunction) => {
      const contentType = req.header("content-type") ?? "";
      if (contentType.includes("application/json")) {
        next();
        return;
      }
      if (req.body && typeof req.body === "string") {
        next();
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      const limit = 1024 * 1024; // 1 MB
      let aborted = false;
      req.on("data", (chunk: Buffer) => {
        if (aborted) {
          return;
        }
        total += chunk.length;
        if (total > limit) {
          aborted = true;
          next(new APIError({status: 413, title: "Request body too large"}));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (aborted) {
          return;
        }
        req.body = Buffer.concat(chunks).toString("utf8");
        next();
      });
      req.on("error", (err) => next(err));
    };

    app.post("/webhooks/notifications", readTextBody, handler);
    app.put("/webhooks/notifications", readTextBody, handler);
  }
}
