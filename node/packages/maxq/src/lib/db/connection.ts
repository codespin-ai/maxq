/**
 * Database connection management for SQLite
 */

import Database from "better-sqlite3";

export type { Database } from "better-sqlite3";

let db: Database.Database | null = null;

/**
 * Create a SQLite database connection
 * @param path - Path to SQLite database file (or ':memory:' for in-memory database)
 */
export function createConnection(path: string): Database.Database {
  if (!db) {
    db = new Database(path);
    // Enable foreign keys (not enabled by default in SQLite)
    db.pragma("foreign_keys = ON");
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeConnection(): void {
  if (db) {
    db.close();
    db = null;
  }
}
