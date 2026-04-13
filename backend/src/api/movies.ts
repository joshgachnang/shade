import path from "node:path";
import {asyncHandler, authenticateMiddleware, logger, modelRouter, Permissions} from "@terreno/api";
import type {Express} from "express";
import {paths} from "../config";
import {Movie} from "../models";
import {processMovie} from "../services/moviePipeline";

export const movieRoutes = modelRouter("/movies", Movie, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["title", "status"],
  sort: "-created",
});

export const registerMovieCustomRoutes = (app: Express) => {
  // Serve extracted frame images statically with path traversal protection
  app.get("/static/movies/*", (req, res) => {
    const resolved = path.resolve(paths.movies, req.params[0]);
    if (!resolved.startsWith(path.resolve(paths.movies))) {
      res.status(403).json({error: "Forbidden"});
      return;
    }
    res.sendFile(resolved);
  });

  app.post(
    "/movies/:id/process",
    authenticateMiddleware,
    asyncHandler(async (req, res) => {
      const movie = await Movie.findExactlyOne({_id: req.params.id});

      if (movie.status === "extracting" || movie.status === "analyzing") {
        res.status(400).json({error: "Movie is already being processed"});
        return;
      }

      movie.status = "extracting";
      movie.errorMessage = undefined;
      await movie.save();

      processMovie(movie._id.toString()).catch((err) => {
        logger.error(`Movie processing failed for ${movie._id}: ${err}`);
      });

      res.json({movieId: movie._id, status: "extracting"});
    })
  );

  app.post(
    "/movies/:id/cancel",
    authenticateMiddleware,
    asyncHandler(async (req, res) => {
      const movie = await Movie.findExactlyOne({_id: req.params.id});

      if (movie.status !== "extracting" && movie.status !== "analyzing") {
        res.status(400).json({error: "Movie is not currently being processed"});
        return;
      }

      movie.status = "error";
      movie.errorMessage = "Cancelled by user";
      await movie.save();

      res.json({movieId: movie._id, status: "error"});
    })
  );

  app.get(
    "/movies/:id/progress",
    authenticateMiddleware,
    asyncHandler(async (req, res) => {
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
    "/movies/:id/timeline",
    authenticateMiddleware,
    asyncHandler(async (req, res) => {
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
};
