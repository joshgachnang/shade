export const buildSystemPrompt = (): string => {
  return `You are a precise movie scene analyzer. You analyze individual frames from movies and extract structured information. Always respond with valid JSON matching the exact schema specified. Be thorough but concise in descriptions.`;
};

export const buildUserPrompt = (actors: string[], timestamp: number): string => {
  const actorSection =
    actors.length > 0
      ? `\nKnown actors in this movie: ${actors.join(", ")}. When you recognize a character, try to match them to one of these actors based on appearance.`
      : "";

  return `Analyze this movie frame (timestamp: ${formatTimestamp(timestamp)}).${actorSection}

Respond with ONLY valid JSON in this exact format:
{
  "sceneDescription": "A brief natural language description of what is happening in this scene",
  "objects": [
    {"label": "object name", "confidence": 0.95}
  ],
  "characters": [
    {"name": "Actor Name or Unknown Person 1", "description": "Physical description, clothing, what they are doing", "confidence": 0.9}
  ],
  "text": [
    {"content": "any visible text in the frame", "context": "sign|screen|subtitle|newspaper|label|other"}
  ],
  "tags": ["action", "indoor", "night", "dialogue"],
  "mood": "tense"
}

Rules:
- objects: List all significant visible objects. Include furniture, vehicles, weapons, food, electronics, etc. Confidence 0-1.
- characters: Describe every visible person. If they match a known actor, use that name. Otherwise use "Unknown Person N". Include what they're wearing and doing.
- text: Extract ALL visible text — signs, screens, papers, subtitles, labels, etc. Specify the context/source.
- tags: High-level scene tags. Include: indoor/outdoor, day/night, action/dialogue/transition, setting type (office, street, forest, etc.)
- mood: Single word or short phrase for the scene's emotional tone.
- If a field has no data (e.g., no text visible), use an empty array [].
- Confidence values should reflect how certain you are (0.0-1.0).`;
};

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};
