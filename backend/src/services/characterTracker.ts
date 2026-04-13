import {logger} from "@terreno/api";
import {Character, FrameAnalysis, Movie} from "../models";

export const trackCharacters = async (movieId: string): Promise<void> => {
  const movie = await Movie.findExactlyOne({_id: movieId});
  const analyses = await FrameAnalysis.find({movieId}).sort({timestamp: 1}).lean();

  logger.info(`Tracking characters across ${analyses.length} frame analyses for "${movie.title}"`);

  // Collect all character appearances grouped by name
  const characterMap = new Map<string, {
    appearances: Array<{frameId: string; timestamp: number; description: string}>;
    firstSeen: number;
    lastSeen: number;
  }>();

  for (const analysis of analyses) {
    for (const char of analysis.characters) {
      const name = char.name.trim();
      if (!name) {
        continue;
      }

      const existing = characterMap.get(name);
      if (existing) {
        existing.appearances.push({
          frameId: analysis.frameId.toString(),
          timestamp: analysis.timestamp,
          description: char.description,
        });
        existing.lastSeen = Math.max(existing.lastSeen, analysis.timestamp);
      } else {
        characterMap.set(name, {
          appearances: [{
            frameId: analysis.frameId.toString(),
            timestamp: analysis.timestamp,
            description: char.description,
          }],
          firstSeen: analysis.timestamp,
          lastSeen: analysis.timestamp,
        });
      }
    }
  }

  // Match to known actors using fuzzy name matching
  const actors = movie.actors || [];
  const matchActorName = (characterName: string): string | undefined => {
    const lower = characterName.toLowerCase();
    return actors.find((actor) => {
      const actorLower = actor.toLowerCase();
      // Exact match
      if (lower === actorLower) {
        return true;
      }
      // Last name match
      const actorParts = actorLower.split(" ");
      const charParts = lower.split(" ");
      if (actorParts.some((part) => charParts.includes(part) && part.length > 2)) {
        return true;
      }
      // Contains match
      if (lower.includes(actorLower) || actorLower.includes(lower)) {
        return true;
      }
      return false;
    });
  };

  // Delete existing characters for this movie and recreate
  await Character.deleteMany({movieId});

  for (const [name, data] of characterMap) {
    const actorName = matchActorName(name);

    await Character.create({
      movieId,
      name,
      actorName,
      appearances: data.appearances.map((a) => ({
        frameId: a.frameId,
        timestamp: a.timestamp,
        description: a.description,
      })),
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
      totalAppearances: data.appearances.length,
    });
  }

  logger.info(`Tracked ${characterMap.size} unique characters for "${movie.title}"`);
};
