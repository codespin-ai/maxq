import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
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

    // Get total count
    const countRows =
      flowName && status
        ? await executeSelect(
            ctx.db,
            schema,
            (q, p) =>
              q
                .from("run")
                .where(
                  (r) => r.flow_name === p.flowName && r.status === p.status,
                )
                .select((r) => ({ id: r.id })),
            { flowName, status },
          )
        : flowName
          ? await executeSelect(
              ctx.db,
              schema,
              (q, p) =>
                q
                  .from("run")
                  .where((r) => r.flow_name === p.flowName)
                  .select((r) => ({ id: r.id })),
              { flowName },
            )
          : status
            ? await executeSelect(
                ctx.db,
                schema,
                (q, p) =>
                  q
                    .from("run")
                    .where((r) => r.status === p.status)
                    .select((r) => ({ id: r.id })),
                { status },
              )
            : await executeSelect(
                ctx.db,
                schema,
                (q) => q.from("run").select((r) => ({ id: r.id })),
                {},
              );
    const total = countRows.length;

    // Get paginated data
    const rows =
      flowName && status
        ? sortBy === "createdAt"
          ? sortOrder === "desc"
            ? await executeSelect(
                ctx.db,
                schema,
                (q, p) =>
                  q
                    .from("run")
                    .where(
                      (r) =>
                        r.flow_name === p.flowName && r.status === p.status,
                    )
                    .orderByDescending((r) => r.created_at)
                    .skip(p.offset)
                    .take(p.limit),
                { flowName, status, offset, limit },
              )
            : await executeSelect(
                ctx.db,
                schema,
                (q, p) =>
                  q
                    .from("run")
                    .where(
                      (r) =>
                        r.flow_name === p.flowName && r.status === p.status,
                    )
                    .orderBy((r) => r.created_at)
                    .skip(p.offset)
                    .take(p.limit),
                { flowName, status, offset, limit },
              )
          : sortOrder === "desc"
            ? await executeSelect(
                ctx.db,
                schema,
                (q, p) =>
                  q
                    .from("run")
                    .where(
                      (r) =>
                        r.flow_name === p.flowName && r.status === p.status,
                    )
                    .orderByDescending((r) => r.completed_at)
                    .skip(p.offset)
                    .take(p.limit),
                { flowName, status, offset, limit },
              )
            : await executeSelect(
                ctx.db,
                schema,
                (q, p) =>
                  q
                    .from("run")
                    .where(
                      (r) =>
                        r.flow_name === p.flowName && r.status === p.status,
                    )
                    .orderBy((r) => r.completed_at)
                    .skip(p.offset)
                    .take(p.limit),
                { flowName, status, offset, limit },
              )
        : flowName
          ? sortBy === "createdAt"
            ? sortOrder === "desc"
              ? await executeSelect(
                  ctx.db,
                  schema,
                  (q, p) =>
                    q
                      .from("run")
                      .where((r) => r.flow_name === p.flowName)
                      .orderByDescending((r) => r.created_at)
                      .skip(p.offset)
                      .take(p.limit),
                  { flowName, offset, limit },
                )
              : await executeSelect(
                  ctx.db,
                  schema,
                  (q, p) =>
                    q
                      .from("run")
                      .where((r) => r.flow_name === p.flowName)
                      .orderBy((r) => r.created_at)
                      .skip(p.offset)
                      .take(p.limit),
                  { flowName, offset, limit },
                )
            : sortOrder === "desc"
              ? await executeSelect(
                  ctx.db,
                  schema,
                  (q, p) =>
                    q
                      .from("run")
                      .where((r) => r.flow_name === p.flowName)
                      .orderByDescending((r) => r.completed_at)
                      .skip(p.offset)
                      .take(p.limit),
                  { flowName, offset, limit },
                )
              : await executeSelect(
                  ctx.db,
                  schema,
                  (q, p) =>
                    q
                      .from("run")
                      .where((r) => r.flow_name === p.flowName)
                      .orderBy((r) => r.completed_at)
                      .skip(p.offset)
                      .take(p.limit),
                  { flowName, offset, limit },
                )
          : status
            ? sortBy === "createdAt"
              ? sortOrder === "desc"
                ? await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .where((r) => r.status === p.status)
                        .orderByDescending((r) => r.created_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { status, offset, limit },
                  )
                : await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .where((r) => r.status === p.status)
                        .orderBy((r) => r.created_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { status, offset, limit },
                  )
              : sortOrder === "desc"
                ? await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .where((r) => r.status === p.status)
                        .orderByDescending((r) => r.completed_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { status, offset, limit },
                  )
                : await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .where((r) => r.status === p.status)
                        .orderBy((r) => r.completed_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { status, offset, limit },
                  )
            : sortBy === "createdAt"
              ? sortOrder === "desc"
                ? await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .orderByDescending((r) => r.created_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { offset, limit },
                  )
                : await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .orderBy((r) => r.created_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { offset, limit },
                  )
              : sortOrder === "desc"
                ? await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .orderByDescending((r) => r.completed_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { offset, limit },
                  )
                : await executeSelect(
                    ctx.db,
                    schema,
                    (q, p) =>
                      q
                        .from("run")
                        .orderBy((r) => r.completed_at)
                        .skip(p.offset)
                        .take(p.limit),
                    { offset, limit },
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
