import { pino } from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.LOG_LEVEL,
  transport: process.stdout.isTTY ? { target: "pino-pretty" } : undefined,
  redact: ["credentials", "cookie", "*.cookie", "imei", "*.imei"],
});

export type Logger = typeof logger;
