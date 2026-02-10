#!/usr/bin/env node
/**
 * MaxQ CLI entry point
 * Provides command-line interface for running MaxQ server
 */

import { program } from "commander";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

// Parse command line arguments
program
  .name("maxq")
  .description("MaxQ - DAG-based workflow orchestration engine")
  .version("0.0.11")
  .option("-p, --port <number>", "Server port", "5003")
  .option(
    "-d, --data-dir <path>",
    "Data directory for SQLite database",
    "./data",
  )
  .option("-f, --flows <path>", "Flows root directory", "./flows")
  .option(
    "--max-concurrent-steps <number>",
    "Maximum concurrent step execution",
    "10",
  )
  .option(
    "--max-log-capture <number>",
    "Maximum bytes of stdout/stderr to capture",
    "8192",
  )
  .option(
    "--scheduler-interval <number>",
    "Scheduler polling interval in milliseconds",
    "200",
  )
  .option(
    "--scheduler-batch-size <number>",
    "Steps per scheduler iteration",
    "10",
  )
  .option(
    "--abort-grace-ms <number>",
    "Grace period for aborting processes in milliseconds",
    "5000",
  )
  .option("--log-level <level>", "Log level (debug, info, warn, error)", "info")
  .parse(process.argv);

const options = program.opts();

// Resolve paths
const dataDir = resolve(options.dataDir);
const flowsRoot = resolve(options.flows);
const sqlitePath = resolve(dataDir, "maxq.db");

// Ensure data directory exists
if (!existsSync(dataDir)) {
  console.info(`Creating data directory: ${dataDir}`);
  mkdirSync(dataDir, { recursive: true });
}

// Ensure flows directory exists
if (!existsSync(flowsRoot)) {
  console.info(`Creating flows directory: ${flowsRoot}`);
  mkdirSync(flowsRoot, { recursive: true });
}

// Set environment variables
process.env.MAXQ_SERVER_PORT = options.port;
process.env.MAXQ_DATA_DIR = dataDir;
process.env.MAXQ_FLOWS_ROOT = flowsRoot;
process.env.MAXQ_MAX_CONCURRENT_STEPS = options.maxConcurrentSteps;
process.env.MAXQ_MAX_LOG_CAPTURE = options.maxLogCapture;
process.env.MAXQ_SCHEDULER_INTERVAL_MS = options.schedulerInterval;
process.env.MAXQ_SCHEDULER_BATCH_SIZE = options.schedulerBatchSize;
process.env.MAXQ_ABORT_GRACE_MS = options.abortGraceMs;
process.env.LOG_LEVEL = options.logLevel;

console.info("MaxQ Configuration:");
console.info(`  Port: ${options.port}`);
console.info(`  Database: ${sqlitePath}`);
console.info(`  Flows: ${flowsRoot}`);
console.info(`  Max Concurrent Steps: ${options.maxConcurrentSteps}`);
console.info(`  Log Level: ${options.logLevel}`);
console.info("");

// Run migrations before starting server
import { runMigrations } from "./lib/db/migrations.js";

try {
  await runMigrations(sqlitePath);
  console.info("Database migrations completed successfully");
} catch (error) {
  console.error("Failed to run database migrations:", error);
  process.exit(1);
}

// Start the server
await import("./bin/server.js");
