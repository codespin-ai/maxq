import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { sql, type StageDbRow } from "@codespin/maxq-db";
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

    const params = {
      id,
      run_id: input.runId,
      name: input.name,
      final: input.final,
      status: "pending" as const,
      created_at: now,
    };

    const row = await ctx.db.one<StageDbRow>(
      `${sql.insert("stage", params)} RETURNING *`,
      params,
    );

    logger.info("Created stage", { id, runId: input.runId, name: input.name });

    return success(mapStageFromDb(row));
  } catch (error) {
    logger.error("Failed to create stage", { error, input });
    return failure(error as Error);
  }
}
