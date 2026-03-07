import {afterAll, beforeAll} from "bun:test";
import {logger} from "@terreno/api";
import mongoose from "mongoose";

let mongoServer: any = null;
let isServerStarted = false;

const startMongoServer = async (): Promise<string> => {
  const externalUri = process.env.MONGO_URI;

  if (externalUri) {
    logger.debug(`[preload] Using external MongoDB at ${externalUri}`);
    return externalUri;
  }

  const {MongoMemoryServer} = await import("mongodb-memory-server-global");
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  logger.debug(`[preload] Started MongoMemoryServer at ${uri}`);
  return uri;
};

beforeAll(async () => {
  if (isServerStarted) {
    return;
  }

  // Set test env vars before anything imports config
  process.env.NODE_ENV = "test";
  process.env.TOKEN_SECRET = "test-secret";
  process.env.PORT = "0"; // let OS pick a port

  const uri = await startMongoServer();

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 5000,
  });

  // Initialize all registered models
  const models = Object.keys(mongoose.models);
  await Promise.all(models.map((m) => mongoose.models[m].init()));

  isServerStarted = true;
  logger.debug(`[preload] MongoDB ready, ${models.length} models initialized`);
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
});
