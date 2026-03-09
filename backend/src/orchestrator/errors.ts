import {logger} from "@terreno/api";

export const logError = (context: string, err: unknown): void => {
  logger.error(`${context}: ${err}`);
  if (err instanceof Error) {
    logger.error(err.stack ?? "no stack trace");
  }
};
