import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeUpdate, executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DataContext } from "../data-context.js";
import type { Run, UpdateRunInput } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run");

/**
 * Update a run
 *
 * @param ctx - Data context containing database connection
 * @param id - Run ID
 * @param input - Update parameters
 * @returns Result containing the updated run or an error
 */
export async function updateRun(
  ctx: DataContext,
  id: string,
  input: UpdateRunInput,
): Promise<Result<Run, Error>> {
  try {
    if (Object.keys(input).length === 0) {
      return failure(new Error("No fields to update"));
    }

    // Fetch current row to get existing values
    const existingRows = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("run").where((r) => r.id === p.id),
      { id },
    );

    const existing = existingRows[0];
    if (!existing) {
      return failure(new Error("Run not found"));
    }

    // Calculate final values using new or existing
    const finalStartedAt = input.startedAt ?? existing.started_at;
    const finalCompletedAt = input.completedAt ?? existing.completed_at;
    const finalDurationMs =
      input.startedAt && input.completedAt
        ? input.completedAt - input.startedAt
        : input.startedAt && existing.completed_at
          ? existing.completed_at - input.startedAt
          : input.completedAt && existing.started_at
            ? input.completedAt - existing.started_at
            : existing.duration_ms;

    // Update with object literal - all values passed via params
    const rows = await executeUpdate(
      ctx.db,
      schema,
      (q, p) =>
        q
          .update("run")
          .set({
            status: p.status,
            output: p.output,
            error: p.error,
            started_at: p.startedAt,
            completed_at: p.completedAt,
            duration_ms: p.durationMs,
            stdout: p.stdout,
            stderr: p.stderr,
            name: p.name,
            description: p.description,
          })
          .where((r) => r.id === p.id)
          .returning((r) => r),
      {
        id,
        status: input.status ?? existing.status,
        output: input.output ?? existing.output,
        error: input.error ?? existing.error,
        startedAt: finalStartedAt,
        completedAt: finalCompletedAt,
        durationMs: finalDurationMs,
        stdout: input.stdout ?? existing.stdout,
        stderr: input.stderr ?? existing.stderr,
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
      },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Run not found after update"));
    }

    logger.info("Updated run", { id, updates: Object.keys(input) });

    return success(mapRunFromDb(row));
  } catch (error) {
    logger.error("Failed to update run", { error, id, input });
    return failure(error as Error);
  }
}
