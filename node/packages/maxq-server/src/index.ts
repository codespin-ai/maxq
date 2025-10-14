import express from "express";
import { config } from "dotenv";
import { createLogger } from "@codespin/maxq-logger";
import { createConnection } from "@codespin/maxq-db";
import { createRunsRouter } from "./routes/runs.js";
import type { DataContext } from "./domain/data-context.js";
import type { ExecutorConfig } from "./executor/types.js";
import { StepProcessRegistry } from "./executor/process-registry.js";
import { performStartupCleanup } from "./startup/cleanup.js";

// Export types for use in tests and clients
export type {
  Run,
  Stage,
  Step,
  CreateRunInput,
  UpdateRunInput,
  UpdateStageInput,
  UpdateStepInput,
  PaginatedResult,
  ListRunsParams,
  ListStepsParams,
} from "./types.js";
export type { RunStatus, StageStatus, StepStatus } from "@codespin/maxq-db";

// Export testing utilities
export { waitForAllOrchestrators } from "./executor/orchestrator.js";

// Load environment variables
config();

const logger = createLogger("maxq-server");
const app = express();
const port = process.env.MAXQ_SERVER_PORT || process.env.PORT || 5003;

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
const databaseUrl =
  process.env.MAXQ_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/maxq";
const db = createConnection(databaseUrl);

// Initialize executor config
const executorConfig: ExecutorConfig = {
  flowsRoot: process.env.MAXQ_FLOWS_ROOT || "/flows",
  maxLogCapture: parseInt(process.env.MAXQ_MAX_LOG_CAPTURE || "8192", 10),
  maxConcurrentSteps: parseInt(
    process.env.MAXQ_MAX_CONCURRENT_STEPS || "10",
    10,
  ),
};

// Determine API URL for callbacks
const apiUrl = process.env.MAXQ_API_URL || `http://localhost:${port}/api/v1`;

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
    await db.one("SELECT 1 as ok");
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
    const abortGraceMs = parseInt(
      process.env.MAXQ_ABORT_GRACE_MS || "5000",
      10,
    );
    await performStartupCleanup(db, abortGraceMs);

    // Start listening
    app.listen(port, () => {
      logger.info("MaxQ server running", { port });
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully");
  process.exit(0);
});

// Start the server
start();
