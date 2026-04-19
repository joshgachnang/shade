import {APIError, asyncHandler, logger, type TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {paths} from "../config";
import {isMovieProcessing, MOVIE_STATUS} from "../constants/statuses";
import {Movie} from "../models";
import {processMovie} from "../services/moviePipeline";
import {serveStaticUnder} from "../utils/staticFiles";

export class MovieActionsPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    app.get("/static/movies/*", serveStaticUnder(paths.movies));

    app.post(
      "/movie-actions/:id/process",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const movie = await Movie.findExactlyOne({_id: req.params.id});

        if (isMovieProcessing(movie.status)) {
          throw new APIError({status: 400, title: "Movie is already being processed"});
        }

        movie.status = MOVIE_STATUS.extracting;
        movie.errorMessage = undefined;
        await movie.save();

        processMovie(movie._id.toString()).catch((err) => {
          logger.error(`Movie processing failed for ${movie._id}: ${err}`);
        });

        res.json({movieId: movie._id, status: MOVIE_STATUS.extracting});
      })
    );

    app.post(
      "/movie-actions/:id/cancel",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const movie = await Movie.findExactlyOne({_id: req.params.id});

        if (!isMovieProcessing(movie.status)) {
          throw new APIError({status: 400, title: "Movie is not currently being processed"});
        }

        movie.status = MOVIE_STATUS.error;
        movie.errorMessage = "Cancelled by user";
        await movie.save();

        res.json({movieId: movie._id, status: MOVIE_STATUS.error});
      })
    );

    app.get(
      "/movie-actions/:id/progress",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const movie = await Movie.findExactlyOne({_id: req.params.id});

        const percentage =
          movie.frameCount > 0
            ? Math.round((movie.processedFrameCount / movie.frameCount) * 100)
            : 0;

        res.json({
          status: movie.status,
          totalFrames: movie.frameCount,
          processedFrames: movie.processedFrameCount,
          percentage,
          currentPhase: movie.status,
        });
      })
    );

    app.get(
      "/movie-actions/:id/timeline",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const {FrameAnalysis} = await import("../models/frameAnalysis");
        const movieId = req.params.id;
        const {character, object} = req.query;

        const filter: Record<string, unknown> = {movieId};
        if (character) {
          filter["characters.name"] = {$regex: character, $options: "i"};
        }
        if (object) {
          filter["objects.label"] = {$regex: object, $options: "i"};
        }

        const analyses = await FrameAnalysis.find(filter)
          .sort({timestamp: 1})
          .select("timestamp sceneDescription characters objects tags mood frameId")
          .lean();

        res.json(analyses);
      })
    );
  }
}
