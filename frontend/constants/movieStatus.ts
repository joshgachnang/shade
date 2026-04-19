/**
 * Canonical movie pipeline status strings. Keep in sync with
 * `backend/src/types/models/movieTypes.ts`. Using constants instead of raw
 * strings makes typos compile errors and centralizes the badge mapping.
 */
export const movieStatus = {
  pending: "pending",
  extracting: "extracting",
  analyzing: "analyzing",
  complete: "complete",
  error: "error",
} as const;

export type MovieStatus = (typeof movieStatus)[keyof typeof movieStatus];

export const isMovieProcessing = (status: string): boolean => {
  return status === movieStatus.extracting || status === movieStatus.analyzing;
};

type BadgeStatus = "info" | "success" | "error" | "warning" | "neutral";

export const movieStatusBadgeMap: Record<string, BadgeStatus> = {
  [movieStatus.pending]: "neutral",
  [movieStatus.extracting]: "info",
  [movieStatus.analyzing]: "warning",
  [movieStatus.complete]: "success",
  [movieStatus.error]: "error",
};

export const getMovieStatusBadge = (status: string): BadgeStatus => {
  return movieStatusBadgeMap[status] ?? "neutral";
};
