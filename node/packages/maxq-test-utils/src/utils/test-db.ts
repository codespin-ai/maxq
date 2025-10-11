import knex from "knex";
import { Knex } from "knex";
import * as path from "path";
import { fileURLToPath } from "url";
import { Logger, consoleLogger } from "./test-logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestDatabaseConfig {
  dbName?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  logger?: Logger;
}

export class TestDatabase {
  private db: Knex | null = null;
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

    // Now connect to the fresh test database
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
    if (!this.db) throw new Error("Database not initialized");

    // Get all tables except knex_migrations
    const tables = await this.db("pg_tables")
      .select("tablename")
      .where("schemaname", "public")
      .whereNotIn("tablename", ["knex_migrations", "knex_migrations_lock"]);

    // Truncate all tables
    for (const { tablename } of tables) {
      await this.db.raw(`TRUNCATE TABLE "${tablename}" CASCADE`);
    }
  }

  public async cleanup(): Promise<void> {
    if (this.db) {
      await this.db.destroy();
      this.db = null;
    }
  }

  public getKnex(): Knex {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }
}
