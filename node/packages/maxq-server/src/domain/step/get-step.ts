import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DataContext } from "../data-context.js";
import type { Step } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:step");

/**
 * Get a step by ID
 *
 * @param ctx - Data context containing database connection
 * @param id - Step ID
 * @returns Result containing the step or an error
 */
export async function getStep(
  ctx: DataContext,
  id: string,
): Promise<Result<Step | null, Error>> {
  try {
    const rows = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("step").where((s) => s.id === p.id),
      { id },
    );

    const row = rows[0];
    if (!row) {
      logger.debug("Step not found", { id });
      return success(null);
    }

    return success(mapStepFromDb(row));
  } catch (error) {
    logger.error("Failed to get step", { error, id });
    return failure(error as Error);
  }
}
