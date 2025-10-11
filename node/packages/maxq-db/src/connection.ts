/**
 * Database connection management
 */

import pgPromise from "pg-promise";
import type { IDatabase } from "pg-promise";

const pgp = pgPromise();

// Parse bigint as number instead of string
pgp.pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

export type Database = IDatabase<unknown>;

let connectionPool: IDatabase<unknown> | null = null;

/**
 * Create a database connection
 */
export function createConnection(connectionString: string): Database {
  if (!connectionPool) {
    connectionPool = pgp(connectionString);
  }
  return connectionPool;
}

/**
 * Close the database connection
 */
export async function closeConnection(): Promise<void> {
  if (connectionPool) {
    await connectionPool.$pool.end();
    connectionPool = null;
  }
}
