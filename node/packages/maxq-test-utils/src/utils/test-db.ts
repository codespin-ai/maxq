/**
 * MaxQ Test Database
 *
 * Manages the maxq.db for integration testing.
 * Uses Knex migrations for schema management.
 * Follows functional style - no classes.
 */

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, rmSync } from "fs";
import Knex from "knex";
import type { Knex as KnexType } from "knex";
import { Logger, consoleLogger } from "./test-logger.js";
import { schema } from "maxq";
import { executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DatabaseSchema } from "maxq";
import type { QueryBuilder } from "@tinqerjs/tinqer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get project root (5 levels up from this file: utils -> src -> maxq-test-utils -> packages -> node -> maxq)
const PROJECT_ROOT = join(__dirname, "../../../../..");

export type TestDatabase = {
  db: Database.Database;
  knex: KnexType | null;
  dbPath: string;
  testDir: string | null;
  logger: Logger;
  isExternal: boolean;
};

export type TestDatabaseState = {
  current: TestDatabase | null;
};

// Module-level singleton state
const state: TestDatabaseState = { current: null };

export function createTestDatabase(
  logger?: Logger,
  externalDbPath?: string,
): TestDatabase {
  const log = logger ?? consoleLogger;
  const isExternal = externalDbPath !== undefined;

  let dbPath: string;
  let testDir: string | null;

  if (externalDbPath !== undefined) {
    // External mode: use existing database at specified path
    dbPath = externalDbPath;
    testDir = null;
    log.info(`Using external database at: ${externalDbPath}`);
  } else {
    // Local mode: create a timestamped test directory under .tests/
    const timestamp = Date.now();
    testDir = join(PROJECT_ROOT, ".tests", `test-${String(timestamp)}`, "data");
    mkdirSync(join(testDir, "db"), { recursive: true });
    dbPath = join(testDir, "db", "maxq.db");
  }

  return {
    db: null as unknown as Database.Database, // Will be set in setup
    knex: null,
    dbPath,
    testDir,
    logger: log,
    isExternal,
  };
}

export async function setupTestDatabase(testDb: TestDatabase): Promise<void> {
  testDb.logger.info("Setting up test database...");

  if (!testDb.isExternal) {
    // Setup database with Knex migrations
    testDb.knex = Knex({
      client: "better-sqlite3",
      connection: { filename: testDb.dbPath },
      useNullAsDefault: true,
      migrations: {
        directory: join(PROJECT_ROOT, "database/maxq/migrations"),
      },
    });
    await testDb.knex.migrate.latest();
  }

  // Create better-sqlite3 instance for queries
  const db = new Database(testDb.dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  (testDb as { db: Database.Database }).db = db;

  testDb.logger.info(
    testDb.isExternal
      ? "External test database connected"
      : "Test database setup complete",
  );
}

export function truncateAllTables(testDb: TestDatabase): void {
  testDb.db.pragma("foreign_keys = OFF");
  const tables = testDb.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'knex_migrations' AND name != 'knex_migrations_lock'",
    )
    .all() as { name: string }[];

  for (const { name } of tables) {
    testDb.db.prepare(`DELETE FROM "${name}"`).run();
  }
  testDb.db.pragma("foreign_keys = ON");

  testDb.logger.debug("Truncated all test tables");
}

export async function teardownTestDatabase(
  testDb: TestDatabase,
): Promise<void> {
  if (testDb.knex !== null) {
    await testDb.knex.destroy();
    testDb.knex = null;
  }
  testDb.db.close();
  (testDb as { db: Database.Database | null }).db = null;

  // Only delete test directory for local databases, not external ones
  if (!testDb.isExternal && testDb.testDir !== null) {
    try {
      const testRunDir = join(testDb.testDir, "..");
      rmSync(testRunDir, { recursive: true, force: true });
      testDb.logger.info(`Test directory deleted: ${testRunDir}`);
    } catch {
      // Ignore if directory doesn't exist
    }
  }
}

// Singleton accessors
export function getTestDatabaseInstance(logger?: Logger): TestDatabase {
  state.current ??= createTestDatabase(logger);
  return state.current;
}

export function getExternalTestDatabaseInstance(
  dbPath: string,
  logger?: Logger,
): TestDatabase {
  state.current ??= createTestDatabase(logger, dbPath);
  return state.current;
}

export function clearTestDatabaseInstance(): void {
  state.current = null;
}

// ==========================================
// MaxQ-specific Helper Functions
// ==========================================

/**
 * Insert a stage for testing purposes
 */
export function insertStage(
  testDb: TestDatabase,
  stage: {
    id: string;
    run_id: string;
    name: string;
    final: boolean;
    status: string;
    created_at: number;
    started_at?: number;
    completed_at?: number;
    termination_reason?: string;
  },
): void {
  const stmt = testDb.db.prepare(
    `INSERT INTO stage (id, run_id, name, final, status, created_at, started_at, completed_at, termination_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    stage.id,
    stage.run_id,
    stage.name,
    stage.final ? 1 : 0, // Convert boolean to SQLite INTEGER
    stage.status,
    stage.created_at,
    stage.started_at || null,
    stage.completed_at || null,
    stage.termination_reason || null,
  );
}

/**
 * Insert a step for testing purposes
 */
export function insertStep(
  testDb: TestDatabase,
  step: {
    id: string;
    run_id: string;
    stage_id: string;
    name: string;
    status: string;
    depends_on: string[];
    retry_count: number;
    max_retries: number;
    created_at: number;
    env?: Record<string, string>;
    fields?: Record<string, unknown>;
    error?: unknown;
    started_at?: number;
    completed_at?: number;
    duration_ms?: number;
    stdout?: string;
    stderr?: string;
    termination_reason?: string;
  },
): void {
  const stmt = testDb.db.prepare(
    `INSERT INTO step (id, run_id, stage_id, name, status, depends_on, retry_count, max_retries,
      env, fields, error, created_at, started_at, completed_at, duration_ms, stdout, stderr,
      termination_reason, queued_at, claimed_at, heartbeat_at, worker_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
  );
  stmt.run(
    step.id,
    step.run_id,
    step.stage_id,
    step.name,
    step.status,
    JSON.stringify(step.depends_on),
    step.retry_count,
    step.max_retries,
    step.env ? JSON.stringify(step.env) : null,
    step.fields ? JSON.stringify(step.fields) : null,
    step.error ? JSON.stringify(step.error) : null,
    step.created_at,
    step.started_at || null,
    step.completed_at || null,
    step.duration_ms || null,
    step.stdout || null,
    step.stderr || null,
    step.termination_reason || null,
  );
}

/**
 * Wait for a Tinqer query to return rows that match a condition
 * Polls the database at regular intervals until condition is met or timeout
 * Uses type-safe Tinqer query builder
 *
 * @param testDb - TestDatabase instance
 * @param queryBuilder - Tinqer query builder function
 * @param params - Query parameters object
 * @param options - Wait options (timeout, interval, condition)
 * @returns Query results when condition is met
 * @throws Error if timeout is reached
 */
export async function waitForQuery<TParams, TResult>(
  testDb: TestDatabase,
  queryBuilder: (q: QueryBuilder<DatabaseSchema>, p: TParams) => any,
  params: TParams,
  options: {
    timeout?: number;
    interval?: number;
    condition?: (rows: TResult[]) => boolean;
  } = {},
): Promise<TResult[]> {
  const timeout = options.timeout || 5000; // 5 seconds default
  const interval = options.interval || 100; // 100ms default
  const condition = options.condition || ((rows) => rows.length > 0);

  const startTime = Date.now();

  while (true) {
    const rawRows = executeSelect(
      testDb.db,
      schema,
      queryBuilder,
      params,
    ) as any[];

    // Convert SQLite types to JavaScript types
    const rows = rawRows.map((row) => {
      const converted: any = { ...row };

      // Convert INTEGER booleans (0/1) to JavaScript booleans
      if ("final" in converted && typeof converted.final === "number") {
        converted.final = converted.final === 1;
      }

      // Parse JSON TEXT fields
      const jsonFields = ["fields", "depends_on", "env", "error", "input"];
      for (const field of jsonFields) {
        if (field in converted && typeof converted[field] === "string") {
          try {
            converted[field] = JSON.parse(converted[field]);
          } catch {
            // If parsing fails, leave as string
          }
        }
      }

      return converted as TResult;
    });

    if (condition(rows)) {
      return rows;
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(
        `waitForQuery timeout after ${timeout}ms. Last result: ${JSON.stringify(rows)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wait for a SQL query to return rows that match a condition
 * Polls the database at regular intervals until condition is met or timeout
 *
 * @deprecated Use waitForQuery with Tinqer query builder instead
 * @param testDb - TestDatabase instance
 * @param query - Raw SQL query string with ? placeholders
 * @param params - Array of query parameters (positional)
 * @param options - Wait options (timeout, interval, condition)
 * @returns Query results when condition is met
 * @throws Error if timeout is reached
 */
export async function waitForSql<T = any>(
  testDb: TestDatabase,
  query: string,
  params: any[] = [],
  options: {
    timeout?: number;
    interval?: number;
    condition?: (rows: T[]) => boolean;
  } = {},
): Promise<T[]> {
  if (!testDb.knex) throw new Error("Database not initialized");

  const timeout = options.timeout || 5000; // 5 seconds default
  const interval = options.interval || 100; // 100ms default
  const condition = options.condition || ((rows) => rows.length > 0);

  const startTime = Date.now();

  while (true) {
    const rows = (await testDb.knex.raw(query, params)) as T[];

    if (condition(rows)) {
      return rows;
    }

    if (Date.now() - startTime > timeout) {
      throw new Error(
        `waitForSql timeout after ${timeout}ms. Query: ${query}. Last result: ${JSON.stringify(rows)}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
