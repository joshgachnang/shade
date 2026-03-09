import {logger} from "@terreno/api";
import mongoose from "mongoose";

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 2000;
let reconnectAttempts = 0;
let reconnecting = false;

const attemptReconnect = async (): Promise<void> => {
  if (reconnecting) {
    return;
  }
  reconnecting = true;

  const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/shade";

  while (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    const delay = RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempts - 1);
    logger.warn(
      `MongoDB reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await mongoose.connect(mongoURI);
      logger.info("MongoDB reconnected successfully");
      reconnectAttempts = 0;
      reconnecting = false;
      return;
    } catch (err) {
      logger.error(`MongoDB reconnect attempt ${reconnectAttempts} failed: ${err}`);
    }
  }

  logger.error(
    `MongoDB reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts — giving up, process may be degraded`
  );
  reconnecting = false;
};

export const connectToMongoDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    logger.info("Already connected to MongoDB");
    return;
  }

  const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/shade";

  try {
    await mongoose.connect(mongoURI);
    logger.info("Connected to MongoDB");
  } catch (error: unknown) {
    logger.error(`MongoDB initial connection error: ${error}`);
    throw error;
  }

  mongoose.connection.on("error", (error: unknown) => {
    logger.error(`MongoDB connection error event: ${error}`);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected — will attempt reconnection");
    attemptReconnect().catch((err) => {
      logger.error(`MongoDB reconnection handler error: ${err}`);
    });
  });

  mongoose.connection.on("reconnected", () => {
    logger.info("MongoDB reconnected (driver auto-reconnect)");
    reconnectAttempts = 0;
    reconnecting = false;
  });

  mongoose.connection.on("close", () => {
    logger.warn("MongoDB connection closed");
  });
};
