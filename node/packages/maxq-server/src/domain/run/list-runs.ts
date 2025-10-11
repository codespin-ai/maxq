import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import type { DataContext } from "../data-context.js";
import type { Run, ListRunsParams, PaginatedResult } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run");

/**
 * List runs with filtering and pagination
 *
 * @param ctx - Data context containing database connection
 * @param params - List parameters (filters, pagination, sorting)
 * @returns Result containing paginated runs or an error
 */
export async function listRuns(
  ctx: DataContext,
  params: ListRunsParams = {},
): Promise<Result<PaginatedResult<Run>, Error>> {
  try {
    const {
      flowName,
      status,
      limit = 20,
      offset = 0,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = params;

    // Build WHERE clause dynamically using named parameters
    let whereClause = "";
    const queryParams: Record<string, unknown> = { limit, offset };

    if (flowName) {
      whereClause += " WHERE flow_name = ${flowName}";
      queryParams.flowName = flowName;
    }

    if (status) {
      whereClause += whereClause ? " AND" : " WHERE";
      whereClause += " status = ${status}";
      queryParams.status = status;
    }

    // Get total count
    const countResult = await ctx.db.one<{ count: string }>(
      `SELECT COUNT(*) as count FROM run${whereClause}`,
      queryParams,
    );
    const total = Number(countResult.count);

    // Get paginated data
    const sortColumn = sortBy === "createdAt" ? "created_at" : "completed_at";
    const orderClause = `ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}`;

    const rows = await ctx.db.many<import("@codespin/maxq-db").RunDbRow>(
      `SELECT * FROM run${whereClause} ${orderClause} LIMIT \${limit} OFFSET \${offset}`,
      queryParams,
    );

    const data = rows.map(mapRunFromDb);

    logger.debug("Listed runs", { total, limit, offset });

    return success({
      data,
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error("Failed to list runs", { error, params });
    return failure(error as Error);
  }
}
