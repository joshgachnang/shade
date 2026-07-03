import {Box, Text} from "@terreno/ui";
import type React from "react";
import {Image, Pressable} from "react-native";
import type {Frame} from "@/store/sdk";
import {formatTimestamp, frameThumbnailStyle, getFrameImageUrl} from "@/utils";

interface MovieFrameThumbnailProps {
  frame: Frame;
  movieId: string;
  onPress: (frame: Frame) => void;
}

/**
 * Grid cell for a single frame thumbnail shown on the movie detail screen.
 * Shows the frame image at 120×68 with its HH:MM:SS timestamp underneath.
 */
export const MovieFrameThumbnail: React.FC<MovieFrameThumbnailProps> = ({
  frame,
  movieId,
  onPress,
}) => {
  return (
    <Pressable onPress={() => onPress(frame)} testID={`movie-detail-frame-${frame._id}`}>
      <Box gap={1}>
        <Image
          source={{
            uri: getFrameImageUrl({movieId, frameNumber: frame.frameNumber}),
          }}
          style={frameThumbnailStyle}
          resizeMode="cover"
        />
        <Text size="sm" color="secondaryLight">
          {formatTimestamp(frame.timestamp)}
        </Text>
      </Box>
    </Pressable>
  );
};
