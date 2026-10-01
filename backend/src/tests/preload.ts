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

// Preload runs before test-module imports. Models such as TriviaQuestion open
// connections at import time, before beforeAll hooks can configure their URI.
process.env.NODE_ENV = "test";
process.env.TOKEN_SECRET = "test-secret";
process.env.PORT = "0";
export const testMongoUri = await startMongoServer();
process.env.TRIVIA_MONGO_URI = testMongoUri;

beforeAll(async () => {
  if (isServerStarted) {
    return;
  }

  try {
    await mongoose.connect(testMongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 5000,
    });

    // Initialize all registered models
    const models = Object.keys(mongoose.models);
    await Promise.all(models.map((m) => mongoose.models[m].init()));

    isServerStarted = true;
    logger.debug(`[preload] MongoDB ready, ${models.length} models initialized`);
  } catch (error) {
    // Allow tests that don't need MongoDB to still run
    logger.warn(`[preload] MongoDB setup failed, tests requiring DB will be skipped: ${error}`);
  }
}, 30000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
});
