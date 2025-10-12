import knex from "knex";
import { Knex } from "knex";
import pgPromise from "pg-promise";
import type { IDatabase } from "pg-promise";
import * as path from "path";
import { fileURLToPath } from "url";
import { Logger, consoleLogger } from "./test-logger.js";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "@codespin/maxq-db";
import type { QueryBuilder } from "@webpods/tinqer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestDatabaseConfig {
  dbName?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  logger?: Logger;
}

const pgp = pgPromise();
// Parse bigint as number instead of string
pgp.pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

export class TestDatabase {
  private db: Knex | null = null;
  private pgDb: IDatabase<unknown> | null = null;
  private config: TestDatabaseConfig;
  private logger: Logger;

  constructor(config: TestDatabaseConfig = {}) {
    this.config = {
      dbName: config.dbName || "maxq_test",
      host: config.host || process.env.MAXQ_DB_HOST || "localhost",
      port: config.port || parseInt(process.env.MAXQ_DB_PORT || "5432"),
      user: config.user || process.env.MAXQ_DB_USER || "postgres",
      password: config.password || process.env.MAXQ_DB_PASSWORD || "postgres",
      logger: config.logger,
    };
    this.logger = config.logger || consoleLogger;
  }

  public async setup(): Promise<void> {
    this.logger.info(`📦 Setting up test database ${this.config.dbName}...`);

    // First connect to postgres database to drop/create test database
    const adminDb = knex({
      client: "pg",
      connection: {
        host: this.config.host,
        port: this.config.port,
        database: "postgres", // Connect to postgres db to manage test db
        user: this.config.user,
        password: this.config.password,
      },
    });

    try {
      // Drop test database if it exists
      this.logger.info(
        `Dropping database ${this.config.dbName} if it exists...`,
      );
      await adminDb.raw(`DROP DATABASE IF EXISTS "${this.config.dbName}"`);

      // Create fresh test database
      this.logger.info(`Creating fresh database ${this.config.dbName}...`);
      await adminDb.raw(`CREATE DATABASE "${this.config.dbName}"`);
    } finally {
      await adminDb.destroy();
    }

    // Now connect to the fresh test database with Knex (for migrations)
    this.db = knex({
      client: "pg",
      connection: {
        host: this.config.host,
        port: this.config.port,
        database: this.config.dbName,
        user: this.config.user,
        password: this.config.password,
      },
    });

    // Also create pg-promise connection for Tinqer queries
    const connectionString = `postgresql://${this.config.user}:${this.config.password}@${this.config.host}:${this.config.port}/${this.config.dbName}`;
    this.pgDb = pgp(connectionString);

    // Run all migrations from scratch
    const migrationsPath = path.join(
      __dirname,
      "../../../../../database/maxq/migrations",
    );
    this.logger.info(`Running full migrations from: ${migrationsPath}`);

    await this.db.migrate.latest({
      directory: migrationsPath,
    });

    this.logger.info(
      `✅ Test database ${this.config.dbName} ready with fresh schema`,
    );
  }

  public async truncateAllTables(): Promise<void> {
    if (!this.pgDb) throw new Error("Database not initialized");

    // Get all tables except knex_migrations using pg-promise
    // This uses the SAME connection pool as the server, avoiding isolation issues
    const tables = await this.pgDb.any<{ tablename: string }>(
      `
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT IN ('knex_migrations', 'knex_migrations_lock')
    `,
    );

    // Truncate all tables using pg-promise (not Knex)
    // This ensures the server's pg-promise connection sees the truncation immediately
    for (const { tablename } of tables) {
      await this.pgDb.none(`TRUNCATE TABLE "${tablename}" CASCADE`);
    }
  }

  public async cleanup(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
    if (this.pgDb) {
      await this.pgDb.$pool.end();
      this.pgDb = null;
    }
  }

  public getKnex(): Knex {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  public getPgDb(): IDatabase<unknown> {
    if (!this.pgDb) throw new Error("Database not initialized");
    return this.pgDb;
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
    if (!this.pgDb) throw new Error("Database not initialized");

    const timeout = options.timeout || 5000; // 5 seconds default
    const interval = options.interval || 100; // 100ms default
    const condition = options.condition || ((rows) => rows.length > 0);

    const startTime = Date.now();

    while (true) {
      const rows = (await executeSelect(
        this.pgDb,
        schema,
        queryBuilder,
        params,
      )) as TResult[];

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
    if (!this.db) throw new Error("Database not initialized");

    const timeout = options.timeout || 5000; // 5 seconds default
    const interval = options.interval || 100; // 100ms default
    const condition = options.condition || ((rows) => rows.length > 0);

    const startTime = Date.now();

    while (true) {
      const rows = await this.db
        .raw(query, params)
        .then((result) => result.rows);

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
