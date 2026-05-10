import type {ScriptResult, ScriptRunner} from "@terreno/api";
import mongoose from "mongoose";
import {connectToMongoDB} from "../utils/database";

/**
 * Creates MongoDB Atlas Search indexes for the FrameAnalysis collection.
 *
 * Run with: bun run backend/src/scripts/createSearchIndex.ts
 *
 * Note: Atlas Search indexes can only be created on MongoDB Atlas clusters,
 * not on local MongoDB instances. If running locally, the search endpoints
 * will fall back to regex-based queries.
 */
export const createSearchIndexesRunner: ScriptRunner = async (
  wetRun,
  ctx
): Promise<ScriptResult> => {
  const results: string[] = [];
  const log = async (message: string) => {
    results.push(message);
    await ctx?.addLog("info", message);
  };

  if (!wetRun) {
    await log("Dry run: would create frame_analysis_search and frame_analysis_autocomplete");
    return {results, success: true};
  }

  if (mongoose.connection.readyState === 0) {
    await connectToMongoDB();
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database connection not established");
  }
  const collection = db.collection("frameanalyses");

  await log("Creating Atlas Search index: frame_analysis_search");
  try {
    await collection.createSearchIndex({
      name: "frame_analysis_search",
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            movieId: {type: "objectId"},
            sceneDescription: {type: "string", analyzer: "lucene.standard"},
            "objects.label": {type: "string", analyzer: "lucene.standard"},
            "characters.name": {type: "string", analyzer: "lucene.standard"},
            "characters.description": {type: "string", analyzer: "lucene.standard"},
            "text.content": {type: "string", analyzer: "lucene.standard"},
            tags: {type: "string", analyzer: "lucene.standard"},
            mood: {type: "string", analyzer: "lucene.standard"},
            timestamp: {type: "number"},
          },
        },
      },
    });
    await log("Created frame_analysis_search index");
  } catch (err) {
    await log(`Failed (may already exist): ${(err as Error).message}`);
  }

  await log("Creating Atlas Search index: frame_analysis_autocomplete");
  try {
    await collection.createSearchIndex({
      name: "frame_analysis_autocomplete",
      definition: {
        mappings: {
          dynamic: false,
          fields: {
            tags: {
              type: "autocomplete",
              analyzer: "lucene.standard",
              tokenization: "edgeGram",
              minGrams: 2,
              maxGrams: 15,
            },
            "objects.label": {
              type: "autocomplete",
              analyzer: "lucene.standard",
              tokenization: "edgeGram",
              minGrams: 2,
              maxGrams: 15,
            },
            "characters.name": {
              type: "autocomplete",
              analyzer: "lucene.standard",
              tokenization: "edgeGram",
              minGrams: 2,
              maxGrams: 15,
            },
          },
        },
      },
    });
    await log("Created frame_analysis_autocomplete index");
  } catch (err) {
    await log(`Failed (may already exist): ${(err as Error).message}`);
  }

  await log("Done. Indexes may take a few minutes to become active on Atlas.");
  return {results, success: true};
};

if (import.meta.main) {
  createSearchIndexesRunner(true)
    .then(async ({results}) => {
      for (const line of results) {
        console.info(line);
      }
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("Script failed:", err);
      process.exit(1);
    });
}
