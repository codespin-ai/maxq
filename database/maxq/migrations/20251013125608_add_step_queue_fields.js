/**
 * Add queue and heartbeat tracking fields to step table
 * Supports scheduler-driven execution model
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  await knex.schema.alterTable("step", (table) => {
    table.bigInteger("queued_at"); // When scheduler queued this step
    table.bigInteger("claimed_at"); // When worker claimed this step
    table.bigInteger("heartbeat_at"); // Last worker heartbeat timestamp
    table.text("worker_id"); // Worker process/thread identifier
  });

  // Add index for efficient scheduler queries (pending steps with dependencies)
  await knex.schema.alterTable("step", (table) => {
    table.index(["status", "queued_at"], "idx_step_scheduler_queue");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.alterTable("step", (table) => {
    table.dropIndex([], "idx_step_scheduler_queue");
  });

  await knex.schema.alterTable("step", (table) => {
    table.dropColumn("queued_at");
    table.dropColumn("claimed_at");
    table.dropColumn("heartbeat_at");
    table.dropColumn("worker_id");
  });
}
