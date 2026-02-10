/**
 * Database migration utilities
 * Runs Knex migrations programmatically
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Knex from "knex";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Run pending database migrations
 * @param sqlitePath - Path to SQLite database file
 */
export async function runMigrations(sqlitePath: string): Promise<void> {
  // Resolve migrations directory
  // Priority: env var > auto-detect from filesystem
  let migrationsDir: string | undefined;

  if (process.env.MAXQ_MIGRATIONS_DIR) {
    migrationsDir = process.env.MAXQ_MIGRATIONS_DIR;
  } else {
    // Migrations are at database/maxq/migrations in the project root
    // __dirname is dist/lib/db, so ../../../../../../database/maxq/migrations
    // goes up through: dist/ → maxq/ → packages/ → node/ → project root → database/maxq/migrations
    migrationsDir = resolve(
      __dirname,
      "../../../../../../database/maxq/migrations",
    );

    if (process.env.DEBUG_MIGRATIONS) {
      console.log(`Using migrations directory: ${migrationsDir}`);
    }

    const fs = await import("fs");
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(
        `Migrations directory not found: ${migrationsDir}\n` +
          `Set MAXQ_MIGRATIONS_DIR environment variable to specify manually.`,
      );
    }
  }

  // Create Knex instance
  const knex = Knex({
    client: "better-sqlite3",
    connection: {
      filename: sqlitePath,
    },
    useNullAsDefault: true,
    migrations: {
      directory: migrationsDir,
      tableName: "knex_migrations",
    },
  });

  try {
    // Run pending migrations
    const [batchNo, log] = await knex.migrate.latest();

    if (log.length === 0) {
      console.log("Database is up to date");
    } else {
      console.log(`Batch ${batchNo} ran the following migrations:`);
      log.forEach((migration: string) => {
        console.log(`  - ${migration}`);
      });
    }
  } finally {
    // Clean up connection
    await knex.destroy();
  }
}
