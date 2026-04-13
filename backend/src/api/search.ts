import {asyncHandler, authenticateMiddleware} from "@terreno/api";
import type {Express} from "express";
import mongoose from "mongoose";
import {FrameAnalysis} from "../models";

export const registerSearchRoutes = (app: Express) => {
  app.get(
    "/search",
    authenticateMiddleware,
    asyncHandler(async (req, res) => {
      const {q, movieId, type} = req.query;

      if (!q || typeof q !== "string") {
        res.status(400).json({error: "Query parameter 'q' is required"});
        return;
      }

      const searchType = (typeof type === "string" ? type : "all") as string;

      // Build the Atlas Search query
      const searchPaths: string[] = [];
      if (searchType === "all" || searchType === "objects") {
        searchPaths.push("objects.label");
      }
      if (searchType === "all" || searchType === "characters") {
        searchPaths.push("characters.name", "characters.description");
      }
      if (searchType === "all" || searchType === "text") {
        searchPaths.push("text.content");
      }
      if (searchType === "all" || searchType === "tags") {
        searchPaths.push("tags");
      }
      if (searchType === "all") {
        searchPaths.push("sceneDescription", "mood");
      }

      // Build Atlas Search query — use compound when filtering by movieId
      const searchStage = movieId
        ? {
            $search: {
              index: "frame_analysis_search",
              compound: {
                must: [{text: {query: q, path: searchPaths, fuzzy: {maxEdits: 1}}}],
                filter: [{equals: {path: "movieId", value: new mongoose.Types.ObjectId(movieId as string)}}],
              },
            },
          }
        : {
            $search: {
              index: "frame_analysis_search",
              text: {query: q, path: searchPaths, fuzzy: {maxEdits: 1}},
            },
          };

      const pipeline: mongoose.PipelineStage[] = [
        searchStage,
        {
          $addFields: {
            score: {$meta: "searchScore"},
          },
        },
        {$sort: {score: -1}},
        {$limit: 50},
        {
          $lookup: {
            from: "frames",
            localField: "frameId",
            foreignField: "_id",
            as: "frame",
          },
        },
        {$unwind: "$frame"},
        {
          $project: {
            frameId: 1,
            movieId: 1,
            timestamp: 1,
            sceneDescription: 1,
            objects: 1,
            characters: 1,
            text: 1,
            tags: 1,
            mood: 1,
            score: 1,
            "frame.imagePath": 1,
            "frame.frameNumber": 1,
          },
        },
      ];

      try {
        const results = await FrameAnalysis.aggregate(pipeline);
        res.json({query: q, type: searchType, count: results.length, results});
      } catch {
        // Fallback: regex-based search if Atlas Search isn't configured
        const regex = new RegExp(q, "i");
        const filter: Record<string, unknown> = {
          $or: searchPaths.map((p) => ({[p]: regex})),
        };
        if (movieId) {
          filter.movieId = new mongoose.Types.ObjectId(movieId as string);
        }

        const results = await FrameAnalysis.find(filter)
          .sort({timestamp: 1})
          .limit(50)
          .populate("frameId", "imagePath frameNumber")
          .lean();

        const mapped = results.map((r) => ({
          ...r,
          frame: r.frameId,
          score: 1,
        }));

        res.json({query: q, type: searchType, count: mapped.length, results: mapped});
      }
    })
  );

  app.get(
    "/search/suggest",
    authenticateMiddleware,
    asyncHandler(async (req, res) => {
      const {q} = req.query;

      if (!q || typeof q !== "string") {
        res.status(400).json({error: "Query parameter 'q' is required"});
        return;
      }

      // Use Atlas Search autocomplete if available, fallback to regex
      try {
        const pipeline: mongoose.PipelineStage[] = [
          {
            $search: {
              index: "frame_analysis_autocomplete",
              autocomplete: {
                query: q,
                path: "tags",
                fuzzy: {maxEdits: 1},
              },
            },
          },
          {$limit: 10},
          {$project: {tags: 1, "objects.label": 1, "characters.name": 1}},
        ];

        const results = await FrameAnalysis.aggregate(pipeline);

        // Extract unique suggestions
        const suggestions = new Set<string>();
        for (const result of results) {
          for (const tag of result.tags || []) {
            if (tag.toLowerCase().includes(q.toLowerCase())) {
              suggestions.add(tag);
            }
          }
          for (const obj of result.objects || []) {
            if (obj.label.toLowerCase().includes(q.toLowerCase())) {
              suggestions.add(obj.label);
            }
          }
          for (const char of result.characters || []) {
            if (char.name.toLowerCase().includes(q.toLowerCase())) {
              suggestions.add(char.name);
            }
          }
        }

        res.json({suggestions: [...suggestions].slice(0, 10)});
      } catch {
        // Fallback: regex-based suggestions if Atlas Search isn't configured
        const regex = new RegExp(q, "i");
        const [tagResults, objectResults, characterResults] = await Promise.all([
          FrameAnalysis.distinct("tags", {tags: regex}),
          FrameAnalysis.distinct("objects.label", {"objects.label": regex}),
          FrameAnalysis.distinct("characters.name", {"characters.name": regex}),
        ]);

        const suggestions = [...new Set([...tagResults, ...objectResults, ...characterResults])].slice(0, 10);
        res.json({suggestions});
      }
    })
  );
};
