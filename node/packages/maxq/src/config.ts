import { join } from "path";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`ERROR: Required environment variable ${name} is not set`);
    process.exit(1);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  return value !== undefined ? parseInt(value, 10) : defaultValue;
}

const dataDir = required("MAXQ_DATA_DIR");

export const config = {
  server: {
    host: optional("MAXQ_SERVER_HOST", "127.0.0.1"),
    port: optionalInt("MAXQ_SERVER_PORT", 5003),
  },
  db: {
    dataDir,
    dbPath: join(dataDir, "maxq.db"),
  },
  executor: {
    flowsRoot: required("MAXQ_FLOWS_ROOT"),
    maxLogCapture: optionalInt("MAXQ_MAX_LOG_CAPTURE", 8192),
    maxConcurrentSteps: optionalInt("MAXQ_MAX_CONCURRENT_STEPS", 10),
  },
  apiUrl: process.env.MAXQ_API_URL,
  apiKey: process.env.MAXQ_API_KEY ?? "",
  abortGraceMs: optionalInt("MAXQ_ABORT_GRACE_MS", 5000),
  logging: {
    level: optional("LOG_LEVEL", "info"),
  },
};

export type Config = typeof config;
