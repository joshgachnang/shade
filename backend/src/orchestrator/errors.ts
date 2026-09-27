import * as Sentry from "@sentry/node";
import {logger} from "@terreno/api";

export const logError = (context: string, err: unknown): void => {
  logger.error(`${context}: ${err}`);
  if (err instanceof Error) {
    logger.error(err.stack ?? "no stack trace");
  }
};

export type ReportErrorFn = (
  context: string,
  err: unknown,
  extra?: Record<string, unknown>
) => void;

/** Log an error and send it to Sentry. Use for failures a human needs to see. */
export const reportError: ReportErrorFn = (context, err, extra) => {
  logError(context, err);
  const error = err instanceof Error ? err : new Error(`${context}: ${String(err)}`);
  Sentry.captureException(error, {tags: {context}, extra});
};
