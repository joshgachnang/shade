/**
 * Canonical lifecycle status constants for the movie pipeline. Mirrored in the
 * frontend at `frontend/constants/movieStatus.ts`. Using named constants makes
 * typos compile errors instead of silent mismatches in `Movie.findByIdAndUpdate`
 * callsites.
 */
export const MOVIE_STATUS = {
  pending: "pending",
  extracting: "extracting",
  analyzing: "analyzing",
  complete: "complete",
  error: "error",
} as const;

export type MovieStatus = (typeof MOVIE_STATUS)[keyof typeof MOVIE_STATUS];

export const isMovieProcessing = (status: string): boolean => {
  return status === MOVIE_STATUS.extracting || status === MOVIE_STATUS.analyzing;
};

/**
 * Per-frame lifecycle. Extractor creates rows as `pending`; frameAnalyzer walks
 * through them, marking `complete` or `error` as it goes.
 */
export const FRAME_STATUS = {
  pending: "pending",
  analyzing: "analyzing",
  complete: "complete",
  error: "error",
} as const;

export type FrameStatus = (typeof FRAME_STATUS)[keyof typeof FRAME_STATUS];

/**
 * Channel connection status set on the `Channel` doc; matches the enum in
 * `backend/src/models/channel.ts`.
 */
export const CHANNEL_STATUS = {
  connected: "connected",
  disconnected: "disconnected",
  error: "error",
} as const;

export type ChannelStatus = (typeof CHANNEL_STATUS)[keyof typeof CHANNEL_STATUS];

/**
 * RadioStream status set in `radioTranscriber.ts`. Matches the enum in
 * `backend/src/models/radioStream.ts`.
 */
export const RADIO_STREAM_STATUS = {
  idle: "idle",
  connecting: "connecting",
  connected: "connected",
  error: "error",
} as const;

export type RadioStreamStatus = (typeof RADIO_STREAM_STATUS)[keyof typeof RADIO_STREAM_STATUS];

/**
 * Identifier for the AI backend we route a request to. Used by the
 * orchestrator + aiRequest logs.
 */
export const MODEL_BACKEND = {
  claude: "claude",
  ollama: "ollama",
  openrouter: "openrouter",
} as const;

export type ModelBackend = (typeof MODEL_BACKEND)[keyof typeof MODEL_BACKEND];
