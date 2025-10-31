import { Result, success, failure } from "../../lib/core/index.js";
import { createLogger } from "../../lib/logger/index.js";
import { schema } from "../../lib/db/index.js";
import { executeInsert, executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../data-context.js";
import type { Step, CreateStepInput } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:step");

/**
 * Create a new step
 *
 * @param ctx - Data context containing database connection
 * @param input - Step creation parameters (id supplied by flow)
 * @returns Result containing the created step or an error
 */
export async function createStep(
  ctx: DataContext,
  input: CreateStepInput,
): Promise<Result<Step, Error>> {
  try {
    const now = Date.now();

    // SQLite executeInsert returns row count, not data
    const rowCount = executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q.insertInto("step").values({
          id: p.id,
          run_id: p.runId,
          stage_id: p.stageId,
          name: p.name,
          status: "pending",
          depends_on: p.dependsOn,
          retry_count: 0,
          max_retries: p.maxRetries,
          env: p.env,
          created_at: p.createdAt,
        }),
      {
        id: input.id, // Flow-supplied ID
        runId: input.runId,
        stageId: input.stageId,
        name: input.name,
        dependsOn: JSON.stringify(input.dependsOn), // JSON stored as TEXT in SQLite
        maxRetries: input.maxRetries,
        env: input.env ? JSON.stringify(input.env) : null, // JSON stored as TEXT in SQLite
        createdAt: now,
      },
    );

    if (rowCount === 0) {
      return failure(new Error("Failed to create step"));
    }

    // Follow-up SELECT to get the inserted row
    const rows = executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("step").where((s) => s.id === p.id),
      { id: input.id },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to retrieve created step"));
    }

    logger.info("Created step", {
      id: input.id,
      runId: input.runId,
      name: input.name,
    });

    return success(mapStepFromDb(row));
  } catch (error) {
    logger.error("Failed to create step", { error, input });
    return failure(error as Error);
  }
}
