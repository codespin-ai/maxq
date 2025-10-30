import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeInsert, executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../data-context.js";
import type { Run, CreateRunInput } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run");

/**
 * Create a new run
 *
 * @param ctx - Data context containing database connection
 * @param input - Run creation parameters
 * @returns Result containing the created run or an error
 */
export async function createRun(
  ctx: DataContext,
  input: CreateRunInput,
): Promise<Result<Run, Error>> {
  try {
    const id = uuidv4();
    const now = Date.now();

    // SQLite executeInsert returns row count, not data
    const rowCount = executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q.insertInto("run").values({
          id: p.id,
          flow_name: p.flowName,
          status: "pending",
          input: p.input,
          metadata: p.metadata,
          flow_title: p.flowTitle,
          created_at: p.createdAt,
        }),
      {
        id,
        flowName: input.flowName,
        input: input.input ? JSON.stringify(input.input) : null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        flowTitle: input.flowTitle || null,
        createdAt: now,
      },
    );

    if (rowCount === 0) {
      return failure(new Error("Failed to create run"));
    }

    // Follow-up SELECT to get the inserted row
    const rows = executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run").where((r) => r.id === p.id),
      { id },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to retrieve created run"));
    }

    logger.info("Created run", { id, flowName: input.flowName });

    return success(mapRunFromDb(row));
  } catch (error) {
    logger.error("Failed to create run", { error, input });
    return failure(error as Error);
  }
}
