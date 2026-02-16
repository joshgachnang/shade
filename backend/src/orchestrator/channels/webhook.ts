import crypto from "node:crypto";
import {logger} from "@terreno/api";
import type express from "express";
import {Channel} from "../../models/channel";
import {WebhookSource} from "../../models/webhookSource";
import type {ChannelDocument} from "../../types";
import type {ChannelConnector, InboundMessage} from "./types";

export class WebhookChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  private connected = false;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  registerRoutes(app: express.Application): void {
    app.post("/webhooks/:sourceId", async (req: express.Request, res: express.Response) => {
      try {
        const {sourceId} = req.params;
        const source = await WebhookSource.findById(sourceId);

        if (!source || !source.enabled) {
          res.status(404).json({error: "Webhook source not found"});
          return;
        }

        if (source.secret) {
          const signature = req.headers["x-webhook-signature"] as string;
          if (!this.validateSignature(req.body, source.secret, signature)) {
            res.status(401).json({error: "Invalid signature"});
            return;
          }
        }

        if (this.messageHandler) {
          const body = req.body as {
            content?: string;
            sender?: string;
            externalId?: string;
            metadata?: Record<string, unknown>;
          };

          await this.messageHandler({
            externalId: body.externalId || crypto.randomUUID(),
            sender: body.sender || "webhook",
            senderExternalId: `webhook:${sourceId}`,
            content: body.content || JSON.stringify(req.body),
            groupExternalId: source.groupId.toString(),
            metadata: {
              sourceId,
              sourceName: source.name,
              ...body.metadata,
            },
          });
        }

        await WebhookSource.findByIdAndUpdate(sourceId, {
          $set: {lastReceivedAt: new Date()},
        });

        res.json({received: true});
      } catch (err) {
        logger.error(`Webhook error: ${err}`);
        res.status(500).json({error: "Internal error"});
      }
    });
  }

  async connect(): Promise<void> {
    this.connected = true;

    await Channel.findByIdAndUpdate(this.channelDoc._id, {
      $set: {status: "connected", lastConnectedAt: new Date()},
    });

    logger.info(`Webhook channel "${this.channelDoc.name}" connected`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;

    await Channel.findByIdAndUpdate(this.channelDoc._id, {
      $set: {status: "disconnected"},
    });

    logger.info(`Webhook channel "${this.channelDoc.name}" disconnected`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(_groupExternalId: string, _content: string): Promise<void> {
    // Webhooks are inbound-only; responses are sent via the HTTP response
    logger.debug("Webhook channel does not support outbound messages");
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  private validateSignature(body: unknown, secret: string, signature: string | undefined): boolean {
    if (!signature) {
      return false;
    }

    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
