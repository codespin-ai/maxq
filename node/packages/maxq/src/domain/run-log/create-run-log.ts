import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "../../lib/core/index.js";
import { createLogger } from "../../lib/logger/index.js";
import { schema } from "../../lib/db/index.js";
import { executeInsert, executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../data-context.js";
import type { RunLog, CreateRunLogInput } from "../../types.js";
import { mapRunLogFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run-log");

/**
 * Create a new run log entry
 *
 * @param ctx - Data context containing database connection
 * @param input - Run log creation parameters
 * @returns Result containing the created run log or an error
 */
export async function createRunLog(
  ctx: DataContext,
  input: CreateRunLogInput,
): Promise<Result<RunLog, Error>> {
  try {
    const id = uuidv4();
    const now = Date.now();

    // SQLite executeInsert returns row count, not data
    const rowCount = executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q.insertInto("run_log").values({
          id: p.id,
          run_id: p.runId,
          entity_type: p.entityType,
          entity_id: p.entityId,
          level: p.level,
          message: p.message,
          metadata: p.metadata,
          created_at: p.createdAt,
        }),
      {
        id,
        runId: input.runId,
        entityType: input.entityType,
        entityId: input.entityId || null,
        level: input.level,
        message: input.message,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null, // JSON stored as TEXT
        createdAt: now,
      },
    );

    if (rowCount === 0) {
      return failure(new Error("Failed to create run log"));
    }

    // Follow-up SELECT to get the inserted row
    const rows = executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run_log").where((r) => r.id === p.id),
      { id },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to retrieve created run log"));
    }

    logger.debug("Created run log", {
      id,
      runId: input.runId,
      entityType: input.entityType,
      level: input.level,
    });

    return success(mapRunLogFromDb(row));
  } catch (error) {
    logger.error("Failed to create run log", { error, input });
    return failure(error as Error);
  }
}
