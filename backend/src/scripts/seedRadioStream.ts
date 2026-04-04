// biome-ignore-all lint/suspicious/noConsole: CLI script
import mongoose from "mongoose";
import {RadioStream} from "../models/radioStream";
import {connectToMongoDB} from "../utils/database";

const main = async () => {
  await connectToMongoDB();

  const existing = await RadioStream.findOne({
    streamUrl: "https://a6.asurahosting.com:8210/radio.mp3",
  });
  if (existing) {
    console.log(`Radio stream already exists: ${existing._id} (status: ${existing.status})`);
    if (existing.status !== "active") {
      await RadioStream.findByIdAndUpdate(existing._id, {
        $set: {status: "active", errorMessage: undefined, reconnectCount: 0},
      });
      console.log("Set to active");
    }
    await mongoose.disconnect();
    return;
  }

  const stream = await RadioStream.create({
    name: "90FM Trivia",
    streamUrl: "https://a6.asurahosting.com:8210/radio.mp3",
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

  console.log(`Created radio stream: ${stream._id}`);
  console.log(`  Name: ${stream.name}`);
  console.log(`  URL: ${stream.streamUrl}`);
  console.log(`  Status: ${stream.status}`);
  console.log(`  Webhook: ${stream.slackWebhookUrl}`);
  console.log("\nStream will start transcribing on next server restart.");

  await mongoose.disconnect();
};

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
