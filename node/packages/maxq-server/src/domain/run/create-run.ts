import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeInsert } from "@webpods/tinqer-sql-pg-promise";
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

    const rows = await executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q
          .insertInto("run")
          .values({
            id: p.id,
            flow_name: p.flowName,
            status: "pending",
            input: p.input,
            metadata: p.metadata,
            created_at: p.createdAt,
          })
          .returning((r) => r),
      {
        id,
        flowName: input.flowName,
        input: input.input || null,
        metadata: input.metadata || null,
        createdAt: now,
      },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to create run"));
    }

    logger.info("Created run", { id, flowName: input.flowName });

    return success(mapRunFromDb(row));
  } catch (error) {
    logger.error("Failed to create run", { error, input });
    return failure(error as Error);
  }
}
