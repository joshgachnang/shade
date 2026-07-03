import {MOVIE_STATUS} from "../../constants/statuses";
import {Movie} from "../../models";
import {processMovie} from "../../services/moviePipeline";
import type {ScriptRunner} from "./types";

/**
 * Re-queues every movie currently in `error` status for processing. Useful
 * after transient failures (Anthropic rate limit, filesystem hiccup) to bulk
 * retry without having to click through each movie individually.
 *
 * Dry-run lists what would be retried; wet-run clears the error state and
 * kicks off `processMovie()` in the background for each.
 */
export const retryFailedMovies: ScriptRunner = async (
  wetRun: boolean
): Promise<{success: boolean; results: string[]}> => {
  const results: string[] = [];

  const failed = await Movie.find({status: MOVIE_STATUS.error}).sort({updated: -1});
  if (failed.length === 0) {
    results.push("No movies in error state.");
    return {success: true, results};
  }

  results.push(`Movies in error state: ${failed.length}`);
  for (const movie of failed.slice(0, 20)) {
    results.push(`  - ${movie.title} (${movie._id}): ${movie.errorMessage ?? "(no message)"}`);
  }
  if (failed.length > 20) {
    results.push(`  … and ${failed.length - 20} more`);
  }

  if (!wetRun) {
    results.push("");
    results.push("Dry run — no retries kicked off.");
    return {success: true, results};
  }

  for (const movie of failed) {
    movie.status = MOVIE_STATUS.extracting;
    movie.errorMessage = undefined;
    await movie.save();
    // Fire-and-forget: processMovie writes its own status as it runs.
    processMovie(movie._id.toString()).catch(() => {
      // Errors already logged inside processMovie.
    });
  }

  results.push("");
  results.push(`Re-queued ${failed.length} movies for processing.`);
  return {success: true, results};
};
