/**
 * Add pause and step retry support
 * - Adds "paused" status to run table
 * - No changes needed for step table (already has all necessary fields)
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Note: PostgreSQL doesn't have direct ALTER TYPE for enums in check constraints
  // We need to drop and recreate the constraint
  // However, since we're using TEXT with application-level validation,
  // no database changes are strictly required.

  // The run.status field is TEXT, not an enum, so we can use "paused" without migration
  // The step.status field is also TEXT, so no changes needed

  // For safety and documentation, we add a comment to the tables
  await knex.raw(`
    COMMENT ON COLUMN run.status IS 'Status values: pending, running, paused, completed, failed'
  `);

  await knex.raw(`
    COMMENT ON COLUMN step.status IS 'Status values: pending, running, completed, failed, cancelled'
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // Remove comments
  await knex.raw(`
    COMMENT ON COLUMN run.status IS 'Status values: pending, running, completed, failed'
  `);

  await knex.raw(`
    COMMENT ON COLUMN step.status IS 'Status values: pending, running, completed, failed, cancelled'
  `);
};
