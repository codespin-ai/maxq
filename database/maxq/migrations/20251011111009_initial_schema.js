/**
 * MaxQ Core Tables Migration
 * Creates: run, stage, step tables
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
  // Create run table
  await knex.schema.createTable("run", (table) => {
    table.text("id").primary();
    table.text("flow_name").notNullable();
    table.text("status").notNullable(); // pending, running, completed, failed
    table.jsonb("input");
    table.jsonb("output");
    table.jsonb("error");
    table.jsonb("metadata");
    table.bigInteger("created_at").notNullable();
    table.bigInteger("started_at");
    table.bigInteger("completed_at");
    table.bigInteger("duration_ms");
    table.text("stdout"); // Captured stdout from flow.sh process
    table.text("stderr"); // Captured stderr from flow.sh process
    table.text("name"); // Run display name (set by flow via API)
    table.text("description"); // Run display description (set by flow via API)
    table.text("flow_title"); // Flow display title (from flow.yaml)

    // Indexes
    table.index("flow_name", "idx_run_flow_name");
    table.index("status", "idx_run_status");
    table.index("created_at", "idx_run_created_at");
  });

  // Create stage table
  await knex.schema.createTable("stage", (table) => {
    table.text("id").primary();
    table
      .text("run_id")
      .notNullable()
      .references("id")
      .inTable("run")
      .onDelete("CASCADE");
    table.text("name").notNullable();
    table.boolean("final").notNullable();
    table.text("status").notNullable(); // pending, running, completed, failed
    table.bigInteger("created_at").notNullable();
    table.bigInteger("completed_at");

    // Indexes
    table.index("run_id", "idx_stage_run_id");
    table.index(["run_id", "name"], "idx_stage_name");
    table.unique(["run_id", "name"], { indexName: "idx_stage_run_name" });
  });

  // Create step table
  await knex.schema.createTable("step", (table) => {
    table.text("id").primary(); // Unique step ID supplied by flow (e.g., "fetch-news", "analyzer-0")
    table
      .text("run_id")
      .notNullable()
      .references("id")
      .inTable("run")
      .onDelete("CASCADE");
    table
      .text("stage_id")
      .notNullable()
      .references("id")
      .inTable("stage")
      .onDelete("CASCADE");
    table.text("name").notNullable(); // Step script directory name (e.g., "fetch_news", "analyzer")
    table.text("status").notNullable(); // pending, running, completed, failed, cancelled
    table.jsonb("depends_on").notNullable(); // Array of step IDs: ["fetch-news", "fetch-prices"]
    table.integer("retry_count").notNullable().defaultTo(0);
    table.integer("max_retries").notNullable();
    table.jsonb("env"); // Environment variables
    table.jsonb("fields"); // Step fields posted via POST /runs/{runId}/steps/{stepId}/fields
    table.jsonb("error"); // Error details
    table.bigInteger("created_at").notNullable();
    table.bigInteger("started_at");
    table.bigInteger("completed_at");
    table.bigInteger("duration_ms");
    table.text("stdout"); // Captured stdout from step.sh process
    table.text("stderr"); // Captured stderr from step.sh process

    // Indexes
    table.index("run_id", "idx_step_run_id");
    table.index("stage_id", "idx_step_stage_id");
    table.index("status", "idx_step_status");
    table.index(["run_id", "name"], "idx_step_name");
    table.unique(["run_id", "id"], { indexName: "idx_step_id" }); // Enforce ID uniqueness within run
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists("step");
  await knex.schema.dropTableIfExists("stage");
  await knex.schema.dropTableIfExists("run");
}
