import crypto from "node:crypto";
import {logger} from "@terreno/api";
import type express from "express";
import {Channel} from "../../models/channel";
import {WebhookSource} from "../../models/webhookSource";
import type {ChannelDocument} from "../../types";
import {logError} from "../errors";
import type {ChannelConnector, ConnectorFactory, InboundMessage} from "./types";

export class WebhookChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  private connected = false;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  registerRoutes(app: express.Application): void {
    app.post("/webhooks/:sourceId", async (req: express.Request, res: express.Response) => {
      const {sourceId} = req.params;
      logger.debug(`Webhook received for source ${sourceId}`);

      try {
        const source = await WebhookSource.findById(sourceId);

        if (!source || !source.enabled) {
          logger.debug(`Webhook source ${sourceId} not found or disabled`);
          res.status(404).json({error: "Webhook source not found"});
          return;
        }

        if (source.secret) {
          const signature = req.headers["x-webhook-signature"] as string;
          if (!this.validateSignature(req.body, source.secret, signature)) {
            logger.warn(`Invalid webhook signature for source ${sourceId} (${source.name})`);
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

          logger.debug(
            `Processing webhook from source ${source.name}: sender=${body.sender ?? "webhook"}`
          );

          try {
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
          } catch (err) {
            logger.error(`Error in webhook message handler for source ${source.name}: ${err}`);
          }
        }

        try {
          await WebhookSource.findByIdAndUpdate(sourceId, {
            $set: {lastReceivedAt: new Date()},
          });
        } catch (err) {
          logger.warn(`Failed to update webhook source lastReceivedAt: ${err}`);
        }

        res.json({received: true});
      } catch (err) {
        logError(`Webhook error for source ${sourceId}`, err);
        res.status(500).json({error: "Internal error"});
      }
    });

    logger.info(`Webhook routes registered for channel "${this.channelDoc.name}"`);
  }

  async connect(): Promise<void> {
    this.connected = true;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "connected", lastConnectedAt: new Date()},
      });
    } catch (err) {
      logger.error(`Failed to update webhook channel status: ${err}`);
    }

    logger.info(`Webhook channel "${this.channelDoc.name}" connected`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "disconnected"},
      });
    } catch (err) {
      logger.error(`Failed to update webhook channel status: ${err}`);
    }

    logger.info(`Webhook channel "${this.channelDoc.name}" disconnected`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(_groupExternalId: string, _content: string): Promise<void> {
    // Webhooks are inbound-only; responses are sent via the HTTP response
    logger.debug("Webhook channel does not support outbound messages");
  }

  async createChannel(_name: string): Promise<{id: string}> {
    throw new Error("Webhook channels do not support channel creation");
  }

  async inviteToChannel(_channelId: string, _userId: string): Promise<void> {
    throw new Error("Webhook channels do not support channel invitations");
  }

  async sendMessageWithTs(_groupExternalId: string, _content: string): Promise<string> {
    return "";
  }

  async updateMessage(
    _groupExternalId: string,
    _messageTs: string,
    _content: string
  ): Promise<void> {}

  async addReaction(_groupExternalId: string, _messageTs: string, _emoji: string): Promise<void> {}

  async removeReaction(
    _groupExternalId: string,
    _messageTs: string,
    _emoji: string
  ): Promise<void> {}

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  private validateSignature(body: unknown, secret: string, signature: string | undefined): boolean {
    if (!signature) {
      return false;
    }

    try {
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

      // timingSafeEqual requires equal-length buffers
      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expected);

      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch (err) {
      logger.error(`Webhook signature validation error: ${err}`);
      return false;
    }
  }
}

export const createWebhookConnector: ConnectorFactory = (channelDoc, context) => {
  const connector = new WebhookChannelConnector(channelDoc);
  if (context.expressApp) {
    connector.registerRoutes(context.expressApp);
  }
  return connector;
};
