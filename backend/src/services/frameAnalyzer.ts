import {logger} from "@terreno/api";
import {Frame, FrameAnalysis, Movie} from "../models";
import {analyzeImage} from "./openRouter";
import {buildSystemPrompt, buildUserPrompt} from "./visionPrompt";

interface AnalysisResult {
  sceneDescription: string;
  objects: Array<{label: string; confidence: number}>;
  characters: Array<{name: string; description: string; confidence: number}>;
  text: Array<{content: string; context: string}>;
  tags: string[];
  mood: string;
}

const parseAnalysisResponse = (content: string): AnalysisResult => {
  // Strip markdown code fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const parsed = JSON.parse(cleaned);

  return {
    sceneDescription: parsed.sceneDescription || "",
    objects: Array.isArray(parsed.objects) ? parsed.objects : [],
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    text: Array.isArray(parsed.text) ? parsed.text : [],
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    mood: parsed.mood || "",
  };
};

const analyzeFrame = async (
  frameId: string,
  movieId: string,
  imagePath: string,
  timestamp: number,
  model: string,
  actors: string[]
): Promise<void> => {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(actors, timestamp);

  const response = await analyzeImage({
    imagePath,
    model,
    systemPrompt,
    userPrompt,
  });

  const analysis = parseAnalysisResponse(response.content);

  await FrameAnalysis.create({
    frameId,
    movieId,
    timestamp,
    sceneDescription: analysis.sceneDescription,
    objects: analysis.objects,
    characters: analysis.characters,
    text: analysis.text,
    tags: analysis.tags,
    mood: analysis.mood,
    rawResponse: response.content,
    modelUsed: response.model,
    tokensUsed: response.tokensUsed,
  });

  await Frame.findByIdAndUpdate(frameId, {status: "complete"});
};

export const analyzeAllFrames = async (movieId: string, concurrency = 5): Promise<void> => {
  const movie = await Movie.findExactlyOne({_id: movieId});
  const frames = await Frame.find({movieId, status: "pending"}).sort({frameNumber: 1});

  logger.info(
    `Analyzing ${frames.length} frames for movie ${movie.title} with concurrency ${concurrency}`
  );

  let processedCount = movie.processedFrameCount || 0;

  // Process frames in batches
  for (let i = 0; i < frames.length; i += concurrency) {
    // Check if movie was cancelled
    const currentMovie = await Movie.findOneOrNone({_id: movieId});
    if (!currentMovie || currentMovie.status === "error") {
      logger.info(`Movie ${movieId} processing cancelled, stopping analysis`);
      return;
    }

    const batch = frames.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map((frame) =>
        analyzeFrame(
          frame._id.toString(),
          movieId,
          frame.imagePath,
          frame.timestamp,
          movie.openRouterModel,
          movie.actors
        )
      )
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "rejected") {
        const frame = batch[j];
        logger.error(`Failed to analyze frame ${frame.frameNumber}: ${result.reason}`);
        await Frame.findByIdAndUpdate(frame._id, {
          status: "error",
          errorMessage: String(result.reason),
        });
      } else {
        processedCount++;
      }
    }

    // Update progress
    await Movie.findByIdAndUpdate(movieId, {processedFrameCount: processedCount});

    logger.info(`Progress: ${processedCount}/${frames.length} frames analyzed`);
  }
};
