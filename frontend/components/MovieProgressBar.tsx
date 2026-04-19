import {Box, Text} from "@terreno/ui";
import type React from "react";

interface MovieProgressBarProps {
  processedFrames: number;
  totalFrames: number;
  /** Optional pre-computed 0–100 percentage; otherwise derived from the counts. */
  percentage?: number;
  /** Inner bar height in px. Defaults to 4 (list rows); pass 8 for detail view. */
  height?: 4 | 8;
  /** Show the "X / Y frames (Z%)" caption underneath. */
  showLabel?: boolean;
  testIDPrefix?: string;
}

/**
 * Thin horizontal progress bar reused by the movie list row and the movie
 * detail screen while frames are being extracted/analyzed.
 */
export const MovieProgressBar: React.FC<MovieProgressBarProps> = ({
  processedFrames,
  totalFrames,
  percentage,
  height = 4,
  showLabel = true,
  testIDPrefix,
}) => {
  const pct =
    percentage ?? (totalFrames > 0 ? Math.round((processedFrames / totalFrames) * 100) : 0);

  return (
    <Box gap={1}>
      <Box
        testID={testIDPrefix ? `${testIDPrefix}-bar` : undefined}
        height={height}
        rounding="sm"
        overflow="hidden"
        color="neutralLight"
      >
        <Box height="100%" width={`${pct}%`} color="primary" rounding="sm" />
      </Box>
      {showLabel && (
        <Text
          testID={testIDPrefix ? `${testIDPrefix}-text` : undefined}
          size="sm"
          color="secondaryLight"
          align={height === 8 ? "center" : undefined}
        >
          {processedFrames} / {totalFrames} frames ({pct}%)
        </Text>
      )}
    </Box>
  );
};
