import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const shadeLogger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  transport: isDev
    ? {
        target: "pino-pretty",
        options: { colorize: true },
      }
    : undefined,
});
