import knex from "knex";
import { Knex } from "knex";
import Database from "better-sqlite3";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import { Logger, consoleLogger } from "./test-logger.js";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DatabaseSchema } from "@codespin/maxq-db";
import type { QueryBuilder } from "@tinqerjs/tinqer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestDatabaseConfig {
  dbPath?: string; // Path to SQLite database file
  logger?: Logger;
}

export class TestDatabase {
  private knexDb: Knex | null = null;
  private db: Database.Database | null = null;
  private logger: Logger;
  private dbPath: string;

  constructor(config: TestDatabaseConfig = {}) {
    // Use a unique temporary file for each test database instance
    this.dbPath =
      config.dbPath || path.join("/tmp", `maxq_test_${Date.now()}.db`);
    this.logger = config.logger || consoleLogger;
  }

  public async setup(): Promise<void> {
    this.logger.info(`📦 Setting up test database ${this.dbPath}...`);

    // Delete existing database file if it exists
    if (fs.existsSync(this.dbPath)) {
      this.logger.info(`Deleting existing database file ${this.dbPath}...`);
      fs.unlinkSync(this.dbPath);
    }

    // Create Knex connection for migrations
    this.knexDb = knex({
      client: "better-sqlite3",
      connection: {
        filename: this.dbPath,
      },
      useNullAsDefault: true,
    });

    // Create better-sqlite3 connection for Tinqer queries
    this.db = new Database(this.dbPath);
    this.db.pragma("foreign_keys = ON");

    // Run all migrations from scratch
    const migrationsPath = path.join(
      __dirname,
      "../../../../../database/maxq/migrations",
    );
    this.logger.info(`Running full migrations from: ${migrationsPath}`);

    await this.knexDb.migrate.latest({
      directory: migrationsPath,
    });

    this.logger.info(`✅ Test database ${this.dbPath} ready with fresh schema`);
  }

  public async truncateAllTables(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Get all tables except knex_migrations from SQLite
    const tables = this.db
      .prepare(
        `
      SELECT name FROM sqlite_master
      WHERE type = 'table'
      AND name NOT IN ('knex_migrations', 'knex_migrations_lock', 'sqlite_sequence')
    `,
      )
      .all() as { name: string }[];

    // SQLite doesn't support TRUNCATE, so we use DELETE
    // Disable foreign keys temporarily to avoid constraint errors
    this.db.pragma("foreign_keys = OFF");

    for (const { name } of tables) {
      this.db.prepare(`DELETE FROM "${name}"`).run();
    }

    // Re-enable foreign keys
    this.db.pragma("foreign_keys = ON");
  }

  public async cleanup(): Promise<void> {
    if (this.knexDb) {
      await this.knexDb.destroy();
      this.knexDb = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    // Delete the database file
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
  }

  public getKnex(): Knex {
    if (!this.knexDb) throw new Error("Database not initialized");
    return this.knexDb;
  }

  public getDb(): Database.Database {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  /**
   * Insert a stage for testing purposes
   */
  public async insertStage(stage: {
    id: string;
    run_id: string;
    name: string;
    final: boolean;
    status: string;
    created_at: number;
    started_at?: number;
    completed_at?: number;
    termination_reason?: string;
  }): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(
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
  public async insertStep(step: {
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
  }): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    const stmt = this.db.prepare(
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
   * @param queryBuilder - Tinqer query builder function
   * @param params - Query parameters object
   * @param options - Wait options (timeout, interval, condition)
   * @returns Query results when condition is met
   * @throws Error if timeout is reached
   */
  public async waitForQuery<TParams, TResult>(
    queryBuilder: (q: QueryBuilder<DatabaseSchema>, p: TParams) => any,
    params: TParams,
    options: {
      timeout?: number;
      interval?: number;
      condition?: (rows: TResult[]) => boolean;
    } = {},
  ): Promise<TResult[]> {
    if (!this.db) throw new Error("Database not initialized");

    const timeout = options.timeout || 5000; // 5 seconds default
    const interval = options.interval || 100; // 100ms default
    const condition = options.condition || ((rows) => rows.length > 0);

    const startTime = Date.now();

    while (true) {
      const rows = executeSelect(
        this.db,
        schema,
        queryBuilder,
        params,
      ) as TResult[];

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
   * @param query - Raw SQL query string with ? placeholders
   * @param params - Array of query parameters (positional)
   * @param options - Wait options (timeout, interval, condition)
   * @returns Query results when condition is met
   * @throws Error if timeout is reached
   */
  public async waitForSql<T = any>(
    query: string,
    params: any[] = [],
    options: {
      timeout?: number;
      interval?: number;
      condition?: (rows: T[]) => boolean;
    } = {},
  ): Promise<T[]> {
    if (!this.knexDb) throw new Error("Database not initialized");

    const timeout = options.timeout || 5000; // 5 seconds default
    const interval = options.interval || 100; // 100ms default
    const condition = options.condition || ((rows) => rows.length > 0);

    const startTime = Date.now();

    while (true) {
      const rows = (await this.knexDb.raw(query, params)) as T[];

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
}
