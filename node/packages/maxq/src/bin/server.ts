/**
 * Server startup logic
 * Separated from index.ts to allow importing types without side effects
 */

import express from "express";
import { config as loadEnv } from "dotenv";
import { createLogger } from "../lib/logger/index.js";
import { createConnection, closeConnection } from "../lib/db/index.js";
import { createRunsRouter } from "../routes/runs.js";
import type { DataContext } from "../domain/data-context.js";
import type { ExecutorConfig } from "../executor/types.js";
import { StepProcessRegistry } from "../executor/process-registry.js";
import { performStartupCleanup } from "../startup/cleanup.js";
import { startScheduler, stopScheduler } from "../scheduler/step-scheduler.js";
import { config } from "../config.js";

// Load environment variables
loadEnv();

const logger = createLogger("maxq-server");
const app = express();

// Request parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.debug("Request received", {
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

// Initialize database connection
logger.info("Connecting to SQLite database", { path: config.db.dbPath });
const db = createConnection(config.db.dbPath);

// Initialize executor config
const executorConfig: ExecutorConfig = {
  flowsRoot: config.executor.flowsRoot,
  maxLogCapture: config.executor.maxLogCapture,
  maxConcurrentSteps: config.executor.maxConcurrentSteps,
};

// Determine API URL for callbacks
const apiUrl = config.apiUrl ?? `http://localhost:${config.server.port}/api/v1`;

logger.info("Executor configuration", {
  flowsRoot: executorConfig.flowsRoot,
  maxLogCapture: executorConfig.maxLogCapture,
  maxConcurrentSteps: executorConfig.maxConcurrentSteps,
  apiUrl,
});

// Create process registry
const processRegistry = new StepProcessRegistry();

// Create data context
const ctx: DataContext = {
  db,
  executor: {
    config: executorConfig,
    apiUrl,
    processRegistry,
  },
};

// Health check (no auth required)
app.get("/health", async (_req, res) => {
  const services: Record<string, string> = {};

  // Check database connection
  try {
    db.prepare("SELECT 1 as ok").get();
    services.database = "connected";
  } catch (error) {
    services.database = "disconnected";
    logger.error("Database health check failed", { error });
  }

  const isHealthy = services.database === "connected";

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    services,
  });
});

// API routes
app.use("/api/v1/runs", createRunsRouter(ctx));

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    // Handle JSON parsing errors
    if (err instanceof SyntaxError && "body" in err) {
      logger.warn("Invalid JSON in request", { error: (err as Error).message });
      res.status(400).json({ error: "Invalid JSON in request body" });
      return;
    }

    logger.error("Unhandled error", { error: err });
    res.status(500).json({ error: "Internal server error" });
  },
);

// Start server
async function start(): Promise<void> {
  try {
    // Perform startup cleanup: kill MaxQ processes and fail interrupted work
    await performStartupCleanup(db, config.abortGraceMs);

    // Start listening
    app.listen(config.server.port, config.server.host, () => {
      logger.info("MaxQ server running", {
        host: config.server.host,
        port: config.server.port,
      });
    });

    // Start step scheduler
    startScheduler(ctx);
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  stopScheduler();
  await closeConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  stopScheduler();
  await closeConnection();
  process.exit(0);
});

// Start the server
start();
