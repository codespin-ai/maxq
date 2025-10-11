import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { sql, type StepDbRow } from "@codespin/maxq-db";
import type { DataContext } from "../data-context.js";
import type { Step, CreateStepInput } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:step");

/**
 * Create a new step
 *
 * @param ctx - Data context containing database connection
 * @param input - Step creation parameters
 * @returns Result containing the created step or an error
 */
export async function createStep(
  ctx: DataContext,
  input: CreateStepInput,
): Promise<Result<Step, Error>> {
  try {
    const id = uuidv4();
    const now = Date.now();

    const params = {
      id,
      run_id: input.runId,
      stage_id: input.stageId,
      name: input.name,
      sequence: input.sequence,
      status: "pending" as const,
      depends_on: input.dependsOn,
      retry_count: 0,
      max_retries: input.maxRetries,
      env: input.env || null,
      created_at: now,
    };

    const row = await ctx.db.one<StepDbRow>(
      `${sql.insert("step", params)} RETURNING *`,
      params,
    );

    logger.info("Created step", {
      id,
      runId: input.runId,
      name: input.name,
      sequence: input.sequence,
    });

    return success(mapStepFromDb(row));
  } catch (error) {
    logger.error("Failed to create step", { error, input });
    return failure(error as Error);
  }
}
