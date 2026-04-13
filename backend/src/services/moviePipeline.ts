import {logger} from "@terreno/api";
import {Movie} from "../models";
import {trackCharacters} from "./characterTracker";
import {extractFrames} from "./frameExtractor";
import {analyzeAllFrames} from "./frameAnalyzer";

export const processMovie = async (movieId: string): Promise<void> => {
  logger.info(`Starting movie pipeline for ${movieId}`);

  try {
    // Phase 1: Extract frames
    await Movie.findByIdAndUpdate(movieId, {status: "extracting"});
    const result = await extractFrames(movieId);
    logger.info(`Extracted ${result.frameCount} frames (${result.duration}s, ${result.fps}fps)`);

    // Check if cancelled
    const movieAfterExtract = await Movie.findOneOrNone({_id: movieId});
    if (!movieAfterExtract || movieAfterExtract.status === "error") {
      logger.info(`Movie ${movieId} cancelled after extraction`);
      return;
    }

    // Phase 2: Analyze frames with vision AI
    await Movie.findByIdAndUpdate(movieId, {status: "analyzing"});
    await analyzeAllFrames(movieId);

    // Check if cancelled
    const movieAfterAnalysis = await Movie.findOneOrNone({_id: movieId});
    if (!movieAfterAnalysis || movieAfterAnalysis.status === "error") {
      logger.info(`Movie ${movieId} cancelled after analysis`);
      return;
    }

    // Phase 3: Track characters
    await trackCharacters(movieId);

    // Mark complete
    await Movie.findByIdAndUpdate(movieId, {status: "complete"});
    logger.info(`Movie pipeline complete for ${movieId}`);
  } catch (error) {
    logger.error(`Movie pipeline failed for ${movieId}: ${error}`);
    await Movie.findByIdAndUpdate(movieId, {
      status: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
};
