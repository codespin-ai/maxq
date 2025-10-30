import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@tinqerjs/better-sqlite3-adapter";
import type { DataContext } from "../data-context.js";
import type { Run } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run");

/**
 * Get a run by ID
 *
 * @param ctx - Data context containing database connection
 * @param id - Run ID
 * @returns Result containing the run or an error
 */
export async function getRun(
  ctx: DataContext,
  id: string,
): Promise<Result<Run | null, Error>> {
  try {
    const rows = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run").where((r) => r.id === p.id),
      { id },
    );

    const row = rows[0];
    if (!row) {
      logger.debug("Run not found", { id });
      return success(null);
    }

    return success(mapRunFromDb(row));
  } catch (error) {
    logger.error("Failed to get run", { error, id });
    return failure(error as Error);
  }
}
