import {baseUrl} from "@terreno/rtk";

/**
 * Shared thumbnail style for movie-frame list items. 16:9 aspect at 120×68.
 */
export const frameThumbnailStyle = {width: 120, height: 68, borderRadius: 4} as const;

/**
 * Formats a duration in seconds as HH:MM:SS.
 */
export const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

/**
 * Builds the static URL for a movie frame image. Frame numbers are 0-indexed
 * internally but the on-disk filename is 1-indexed.
 */
export const getFrameImageUrl = ({
  movieId,
  frameNumber,
}: {
  movieId: string;
  frameNumber: number;
}): string => {
  const filenameIndex = String(frameNumber + 1).padStart(6, "0");
  return `${baseUrl}/static/movies/${movieId}/frames/frame_${filenameIndex}.jpg`;
};
