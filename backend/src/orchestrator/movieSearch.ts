import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../config";
import {FrameAnalysis} from "../models";

const BASE_URL = process.env.SHADE_PUBLIC_URL || "https://shade-api.nang.io";

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

export const handleMovieSearch = async (query: string): Promise<string> => {
  // Parse optional --type flag
  let searchType = "all";
  let searchQuery = query;

  const typeMatch = query.match(/--type\s+(\w+)/i);
  if (typeMatch) {
    searchType = typeMatch[1];
    searchQuery = query.replace(/--type\s+\w+/i, "").trim();
  }

  if (!searchQuery) {
    return "Usage: `!search <query>` or `!search <query> --type objects|characters|text|tags`";
  }

  logger.info(`Movie search: q="${searchQuery}" type=${searchType}`);

  // Build regex search paths based on type
  const regex = new RegExp(searchQuery, "i");
  const orConditions: Record<string, unknown>[] = [];

  if (searchType === "all" || searchType === "objects") {
    orConditions.push({"objects.label": regex});
  }
  if (searchType === "all" || searchType === "characters") {
    orConditions.push({"characters.name": regex}, {"characters.description": regex});
  }
  if (searchType === "all" || searchType === "text") {
    orConditions.push({"text.content": regex});
  }
  if (searchType === "all" || searchType === "tags") {
    orConditions.push({tags: regex});
  }
  if (searchType === "all") {
    orConditions.push({sceneDescription: regex}, {mood: regex});
  }

  const results = await FrameAnalysis.find({$or: orConditions})
    .sort({timestamp: 1})
    .limit(20)
    .populate("frameId", "imagePath frameNumber")
    .lean();

  if (results.length === 0) {
    return `No results found for "${searchQuery}".`;
  }

  const lines: string[] = [`*Found ${results.length} matching frames for "${searchQuery}":*\n`];

  for (const r of results) {
    const time = formatTimestamp(r.timestamp);
    const scene = r.sceneDescription?.substring(0, 100) || "";
    const chars = r.characters?.map((c) => c.name).join(", ") || "";
    const objects = r.objects?.map((o) => o.label).join(", ") || "";
    const texts = r.text?.map((t) => t.content).join(" | ") || "";
    const tags = r.tags?.join(", ") || "";
    const frame = r.frameId as unknown as {imagePath?: string; frameNumber?: number};
    const imgPath = frame?.imagePath || "";

    let entry = `\`${time}\` ${scene}`;
    if (chars) {
      entry += `\n    _Characters:_ ${chars}`;
    }
    if (objects) {
      entry += `\n    _Objects:_ ${objects}`;
    }
    if (texts) {
      entry += `\n    _Text:_ ${texts}`;
    }
    if (tags) {
      entry += `\n    _Tags:_ ${tags}`;
    }
    if (imgPath) {
      const relativePath = imgPath.replace(path.resolve(paths.movies), "").replace(/^\//, "");
      const imageUrl = `${BASE_URL}/static/movies/${relativePath}`;
      entry += `\n    ${imageUrl}`;
    }

    lines.push(entry);
  }

  if (results.length === 20) {
    lines.push("\n_Showing first 20 results. Refine your search for more specific results._");
  }

  return lines.join("\n\n");
};
