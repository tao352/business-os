import pino from "pino";

export interface LogContext {
  organizationId?: string;
  tenantId?: string;
  correlationId?: string;
  userId?: string;
  service?: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== "production";

export const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  base: {
    env: process.env.NODE_ENV || "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname,env",
        },
      }
    : undefined,
});

export function createScopedLogger(context: LogContext) {
  return baseLogger.child(context);
}

export const logger = baseLogger;
