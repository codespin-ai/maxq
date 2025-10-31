/**
 * Add pause and step retry support
 * - Adds "paused" status to run table
 * - No changes needed for step table (already has all necessary fields)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // SQLite: No database changes needed
  // The run.status and step.status fields are TEXT, so we can use new values
  // without migration. Application-level validation handles allowed values.

  // Note: SQLite doesn't support COMMENT ON COLUMN syntax
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // No changes to revert
};
