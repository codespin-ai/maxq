/**
 * SQL helper functions for building queries
 */

/**
 * Generate INSERT statement
 */
export function insert(table: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  const columns = keys.map((k) => `"${k}"`).join(", ");
  const values = keys.map((k) => `$(${k})`).join(", ");
  return `INSERT INTO "${table}" (${columns}) VALUES (${values})`;
}

/**
 * Generate UPDATE statement
 */
export function update(table: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  const sets = keys.map((k) => `"${k}" = $(${k})`).join(", ");
  return `UPDATE "${table}" SET ${sets}`;
}
