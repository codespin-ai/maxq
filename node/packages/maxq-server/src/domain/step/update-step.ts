import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import type { StepDbRow } from "@codespin/maxq-db";
import type { DataContext } from "../data-context.js";
import type { Step, UpdateStepInput } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:step");

/**
 * Update an existing step
 *
 * @param ctx - Data context containing database connection
 * @param id - Step ID to update
 * @param input - Step update parameters
 * @returns Result containing the updated step or an error
 */
export async function updateStep(
  ctx: DataContext,
  id: string,
  input: UpdateStepInput,
): Promise<Result<Step, Error>> {
  try {
    const updates: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.status !== undefined) {
      updates.push("status = ${status}");
      params.status = input.status;
    }
    if (input.output !== undefined) {
      updates.push("output = ${output}");
      params.output = input.output;
    }
    if (input.error !== undefined) {
      updates.push("error = ${error}");
      params.error = input.error;
    }
    if (input.retryCount !== undefined) {
      updates.push("retry_count = ${retryCount}");
      params.retryCount = input.retryCount;
    }
    if (input.startedAt !== undefined) {
      updates.push("started_at = ${startedAt}");
      params.startedAt = input.startedAt;
    }
    if (input.completedAt !== undefined) {
      updates.push("completed_at = ${completedAt}");
      params.completedAt = input.completedAt;
    }
    if (input.stdout !== undefined) {
      updates.push("stdout = ${stdout}");
      params.stdout = input.stdout;
    }
    if (input.stderr !== undefined) {
      updates.push("stderr = ${stderr}");
      params.stderr = input.stderr;
    }

    if (updates.length === 0) {
      return failure(new Error("No fields to update"));
    }

    const updateQuery = `
      UPDATE step
      SET ${updates.join(", ")}
      WHERE id = \${id}
      RETURNING *
    `;

    const row = await ctx.db.one<StepDbRow>(updateQuery, params);

    logger.debug("Updated step", { id, updates: Object.keys(input) });

    return success(mapStepFromDb(row));
  } catch (error) {
    logger.error("Failed to update step", { error, id, input });
    return failure(error as Error);
  }
}
