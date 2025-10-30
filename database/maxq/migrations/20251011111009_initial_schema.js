/**
 * MaxQ Core Tables Migration - SQLite
 * Creates: run, stage, step, run_log tables with all fields
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
    table.text("status").notNullable(); // pending, running, paused, completed, failed
    table.text("input"); // JSON stored as TEXT
    table.text("output"); // JSON stored as TEXT
    table.text("error"); // JSON stored as TEXT
    table.text("metadata"); // JSON stored as TEXT
    table.bigInteger("created_at").notNullable();
    table.bigInteger("started_at");
    table.bigInteger("completed_at");
    table.bigInteger("duration_ms");
    table.text("stdout"); // Captured stdout from flow.sh process
    table.text("stderr"); // Captured stderr from flow.sh process
    table.text("name"); // Run display name (set by flow via API)
    table.text("description"); // Run display description (set by flow via API)
    table.text("flow_title"); // Flow display title (from flow.yaml)
    table.text("termination_reason"); // Reason for termination: 'aborted', 'server_restart', etc.

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
    table.integer("final").notNullable(); // SQLite: 0 = false, 1 = true
    table.text("status").notNullable(); // pending, running, completed, failed
    table.bigInteger("created_at").notNullable();
    table.bigInteger("started_at");
    table.bigInteger("completed_at");
    table.text("termination_reason"); // Reason for termination: 'aborted', 'server_restart', etc.

    // Indexes
    table.index("run_id", "idx_stage_run_id");
    table.index(["run_id", "name"], "idx_stage_name");
    table.unique(["run_id", "name"], { indexName: "idx_stage_run_name" });
  });

  // Create step table with scheduler queue fields
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
    table.text("depends_on").notNullable(); // JSON array stored as TEXT: ["fetch-news", "fetch-prices"]
    table.integer("retry_count").notNullable().defaultTo(0);
    table.integer("max_retries").notNullable();
    table.text("env"); // JSON stored as TEXT
    table.text("fields"); // JSON stored as TEXT - Step fields posted via POST /runs/{runId}/steps/{stepId}/fields
    table.text("error"); // JSON stored as TEXT
    table.bigInteger("created_at").notNullable();
    table.bigInteger("started_at");
    table.bigInteger("completed_at");
    table.bigInteger("duration_ms");
    table.text("stdout"); // Captured stdout from step.sh process
    table.text("stderr"); // Captured stderr from step.sh process
    table.text("termination_reason"); // Reason for termination: 'aborted', 'server_restart', etc.

    // Scheduler queue and heartbeat tracking fields
    table.bigInteger("queued_at"); // When scheduler queued this step
    table.bigInteger("claimed_at"); // When worker claimed this step
    table.bigInteger("heartbeat_at"); // Last worker heartbeat timestamp
    table.text("worker_id"); // Worker process/thread identifier

    // Indexes
    table.index("run_id", "idx_step_run_id");
    table.index("stage_id", "idx_step_stage_id");
    table.index("status", "idx_step_status");
    table.index(["run_id", "name"], "idx_step_name");
    table.index(["status", "queued_at"], "idx_step_scheduler_queue"); // For efficient scheduler queries
    table.unique(["run_id", "id"], { indexName: "idx_step_id" }); // Enforce ID uniqueness within run
  });

  // Create run_log table
  await knex.schema.createTable("run_log", (table) => {
    table.text("id").primary(); // UUID stored as text
    table
      .text("run_id")
      .notNullable()
      .references("id")
      .inTable("run")
      .onDelete("CASCADE");
    table.text("entity_type").notNullable().checkIn(["run", "stage", "step"]); // Type of entity: 'run', 'stage', 'step'
    table.text("entity_id"); // Specific entity ID (stage_id or step_id), null for run-level logs
    table.text("level").notNullable().checkIn(["debug", "info", "warn", "error"]); // Log level: 'debug', 'info', 'warn', 'error'
    table.text("message").notNullable();
    table.text("metadata"); // JSON stored as TEXT
    table.bigInteger("created_at").notNullable();

    // Indexes
    table.index(["run_id", "created_at"], "idx_run_log_run_id_created_at");
    table.index(["run_id", "entity_type"], "idx_run_log_entity");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists("run_log");
  await knex.schema.dropTableIfExists("step");
  await knex.schema.dropTableIfExists("stage");
  await knex.schema.dropTableIfExists("run");
}
