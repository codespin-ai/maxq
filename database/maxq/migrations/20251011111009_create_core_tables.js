/**
 * MaxQ Core Tables Migration
 * Creates: run, stage, step, artifact tables
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
    table.text("id").primary();
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
    table.text("name").notNullable();
    table.integer("sequence").notNullable();
    table.text("status").notNullable(); // pending, running, completed, failed, cancelled
    table.jsonb("depends_on").notNullable(); // Array of step names
    table.integer("retry_count").notNullable().defaultTo(0);
    table.integer("max_retries").notNullable();
    table.jsonb("env");
    table.jsonb("output");
    table.jsonb("error");
    table.bigInteger("created_at").notNullable();
    table.bigInteger("started_at");
    table.bigInteger("completed_at");
    table.bigInteger("duration_ms");

    // Indexes
    table.index("run_id", "idx_step_run_id");
    table.index("stage_id", "idx_step_stage_id");
    table.index("status", "idx_step_status");
    table.index(["run_id", "name"], "idx_step_name");
    table.unique(["run_id", "name", "sequence"], {
      indexName: "idx_step_run_name_seq",
    });
  });

  // Create artifact table
  await knex.schema.createTable("artifact", (table) => {
    table.text("id").primary();
    table
      .text("run_id")
      .notNullable()
      .references("id")
      .inTable("run")
      .onDelete("CASCADE");
    table
      .text("step_id")
      .notNullable()
      .references("id")
      .inTable("step")
      .onDelete("CASCADE");
    table.text("step_name").notNullable(); // Denormalized for queries
    table.integer("sequence").notNullable(); // Denormalized for queries
    table.text("name").notNullable();
    table.text("full_path").notNullable(); // step_name[sequence]/name
    table.jsonb("value").notNullable();
    table.specificType("tags", "text[]");
    table.jsonb("metadata");
    table.bigInteger("created_at").notNullable();

    // Indexes
    table.index("run_id", "idx_artifact_run_id");
    table.index("step_id", "idx_artifact_step_id");
    table.index(["run_id", "step_name"], "idx_artifact_step_name");
    table.index(["run_id", "name"], "idx_artifact_name");
    table.index(["run_id", "full_path"], "idx_artifact_full_path");
    table.index("tags", "idx_artifact_tags", "GIN");
    table.index("created_at", "idx_artifact_created_at");
  });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists("artifact");
  await knex.schema.dropTableIfExists("step");
  await knex.schema.dropTableIfExists("stage");
  await knex.schema.dropTableIfExists("run");
}
