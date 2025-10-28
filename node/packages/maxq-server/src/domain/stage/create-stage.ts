import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeInsert } from "@tinqerjs/pg-promise-adapter";
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

    const rows = await executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q
          .insertInto("stage")
          .values({
            id: p.id,
            run_id: p.runId,
            name: p.name,
            final: p.final,
            status: "pending",
            created_at: p.createdAt,
          })
          .returning((r) => r),
      {
        id,
        runId: input.runId,
        name: input.name,
        final: input.final,
        createdAt: now,
      },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to create stage"));
    }

    logger.info("Created stage", { id, runId: input.runId, name: input.name });

    return success(mapStageFromDb(row));
  } catch (error) {
    logger.error("Failed to create stage", { error, input });
    return failure(error as Error);
  }
}
