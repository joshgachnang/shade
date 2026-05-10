import type {ScriptResult, ScriptRunner} from "@terreno/api";
import mongoose from "mongoose";
import {RadioStream} from "../models/radioStream";
import {connectToMongoDB} from "../utils/database";

const STREAM_URL = "https://a6.asurahosting.com:8210/radio.mp3";

export const seedRadioStreamRunner: ScriptRunner = async (wetRun, ctx): Promise<ScriptResult> => {
  const results: string[] = [];
  const log = async (message: string) => {
    results.push(message);
    await ctx?.addLog("info", message);
  };

  if (mongoose.connection.readyState === 0) {
    await connectToMongoDB();
  }

  const existing = await RadioStream.findOne({streamUrl: STREAM_URL});
  if (existing) {
    await log(`Radio stream already exists: ${existing._id} (status: ${existing.status})`);
    if (existing.status !== "active") {
      if (wetRun) {
        await RadioStream.findByIdAndUpdate(existing._id, {
          $set: {status: "active", errorMessage: undefined, reconnectCount: 0},
        });
        await log("Set to active");
      } else {
        await log("Dry run: would set status to active");
      }
    }
    return {results, success: true};
  }

  if (!wetRun) {
    await log("Dry run: would create 90FM Trivia radio stream");
    return {results, success: true};
  }

  const stream = await RadioStream.create({
    name: "90FM Trivia",
    streamUrl: STREAM_URL,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    status: "active",
    deepgramConfig: {
      model: "nova-2",
      language: "en",
      smartFormat: true,
      punctuate: true,
    },
    transcriptBatchIntervalMs: 15000,
  });

  await log(`Created radio stream: ${stream._id}`);
  await log(`  Name: ${stream.name}`);
  await log(`  URL: ${stream.streamUrl}`);
  await log(`  Status: ${stream.status}`);
  await log("Stream will start transcribing on next server restart.");
  return {results, success: true};
};

if (import.meta.main) {
  seedRadioStreamRunner(true)
    .then(async ({results}) => {
      for (const line of results) {
        // biome-ignore lint/suspicious/noConsole: CLI script
        console.log(line);
      }
      await mongoose.disconnect();
    })
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
