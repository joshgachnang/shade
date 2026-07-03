import {Box, Card, Text} from "@terreno/ui";
import type React from "react";
import type {Character} from "@/store/sdk";
import {formatTimestamp} from "@/utils";

interface MovieCharacterCardProps {
  character: Character;
}

/**
 * Card showing a single character's actor/role, appearance count, and the
 * first/last timestamp they appear in the movie.
 */
export const MovieCharacterCard: React.FC<MovieCharacterCardProps> = ({character}) => {
  const showRole = character.actorName && character.name !== character.actorName;

  return (
    <Card testID={`movie-detail-character-${character._id}`}>
      <Box padding={3} gap={1}>
        <Box direction="row" justifyContent="between">
          <Text bold>{character.actorName || character.name}</Text>
          <Text size="sm" color="secondaryLight">
            {character.totalAppearances} scenes
          </Text>
        </Box>
        {showRole && (
          <Text size="sm" color="secondaryLight">
            as {character.name}
          </Text>
        )}
        <Text size="sm" color="secondaryLight">
          {formatTimestamp(character.firstSeen)} - {formatTimestamp(character.lastSeen)}
        </Text>
      </Box>
    </Card>
  );
};
