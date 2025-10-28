import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DataContext } from "../data-context.js";
import type { RunLog, ListRunLogsParams } from "../../types.js";
import { mapRunLogFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run-log");

/**
 * List run logs with filtering
 *
 * @param ctx - Data context containing database connection
 * @param params - List parameters (filters, pagination)
 * @returns Result containing run logs or an error
 */
export async function listRunLogs(
  ctx: DataContext,
  params: ListRunLogsParams,
): Promise<Result<RunLog[], Error>> {
  try {
    const {
      runId,
      entityType,
      entityId,
      level,
      limit = 100,
      before,
      after,
    } = params;

    // Build query with filters
    // Use logical operators to handle optional parameters - if undefined, condition becomes true
    const rows = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("run_log")
          .where(
            (r) =>
              r.run_id === p.runId &&
              (p.entityType === undefined || r.entity_type === p.entityType) &&
              (p.entityId === undefined || r.entity_id === p.entityId) &&
              (p.level === undefined || r.level === p.level) &&
              (p.before === undefined || r.created_at < p.before) &&
              (p.after === undefined || r.created_at > p.after),
          )
          .orderByDescending((r) => r.created_at)
          .take(p.limit),
      {
        runId,
        entityType,
        entityId,
        level,
        before,
        after,
        limit,
      },
    );

    const data = rows.map(mapRunLogFromDb);

    logger.debug("Listed run logs", { runId, count: data.length });

    return success(data);
  } catch (error) {
    logger.error("Failed to list run logs", { error, params });
    return failure(error as Error);
  }
}
