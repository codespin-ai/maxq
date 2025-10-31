import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "../../lib/core/index.js";
import { createLogger } from "../../lib/logger/index.js";
import { schema } from "../../lib/db/index.js";
import { executeInsert, executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../data-context.js";
import type { Stage, CreateStageInput } from "../../types.js";
import { mapStageFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:stage");

/**
 * Create a new stage
 *
 * @param ctx - Data context containing database connection
 * @param input - Stage creation parameters
 * @returns Result containing the created stage or an error
 */
export async function createStage(
  ctx: DataContext,
  input: CreateStageInput,
): Promise<Result<Stage, Error>> {
  try {
    const id = uuidv4();
    const now = Date.now();

    // SQLite executeInsert returns row count, not data
    const rowCount = executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q.insertInto("stage").values({
          id: p.id,
          run_id: p.runId,
          name: p.name,
          final: p.final,
          status: "pending",
          created_at: p.createdAt,
        }),
      {
        id,
        runId: input.runId,
        name: input.name,
        final: input.final ? 1 : 0, // Convert boolean to SQLite INTEGER
        createdAt: now,
      },
    );

    if (rowCount === 0) {
      return failure(new Error("Failed to create stage"));
    }

    // Follow-up SELECT to get the inserted row
    const rows = executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("stage").where((s) => s.id === p.id),
      { id },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to retrieve created stage"));
    }

    logger.info("Created stage", { id, runId: input.runId, name: input.name });

    return success(mapStageFromDb(row));
  } catch (error) {
    logger.error("Failed to create stage", { error, input });
    return failure(error as Error);
  }
}
