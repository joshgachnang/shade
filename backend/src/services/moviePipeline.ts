import {logger} from "@terreno/api";
import {MOVIE_STATUS} from "../constants/statuses";
import {Movie} from "../models";
import {trackCharacters} from "./characterTracker";
import {analyzeAllFrames} from "./frameAnalyzer";
import {extractFrames} from "./frameExtractor";

export const processMovie = async (movieId: string): Promise<void> => {
  logger.info(`Starting movie pipeline for ${movieId}`);

  try {
    await Movie.findByIdAndUpdate(movieId, {status: MOVIE_STATUS.extracting});
    const result = await extractFrames(movieId);
    logger.info(`Extracted ${result.frameCount} frames (${result.duration}s, ${result.fps}fps)`);

    const movieAfterExtract = await Movie.findOneOrNone({_id: movieId});
    if (!movieAfterExtract || movieAfterExtract.status === MOVIE_STATUS.error) {
      logger.info(`Movie ${movieId} cancelled after extraction`);
      return;
    }

    await Movie.findByIdAndUpdate(movieId, {status: MOVIE_STATUS.analyzing});
    await analyzeAllFrames(movieId);

    const movieAfterAnalysis = await Movie.findOneOrNone({_id: movieId});
    if (!movieAfterAnalysis || movieAfterAnalysis.status === MOVIE_STATUS.error) {
      logger.info(`Movie ${movieId} cancelled after analysis`);
      return;
    }

    await trackCharacters(movieId);

    await Movie.findByIdAndUpdate(movieId, {status: MOVIE_STATUS.complete});
    logger.info(`Movie pipeline complete for ${movieId}`);
  } catch (error) {
    logger.error(`Movie pipeline failed for ${movieId}: ${error}`);
    await Movie.findByIdAndUpdate(movieId, {
      status: MOVIE_STATUS.error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
};
