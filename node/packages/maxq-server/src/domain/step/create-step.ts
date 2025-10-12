import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeInsert } from "@webpods/tinqer-sql-pg-promise";
import type { DataContext } from "../data-context.js";
import type { Step, CreateStepInput } from "../../types.js";
import { mapStepFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:step");

/**
 * Create a new step
 *
 * @param ctx - Data context containing database connection
 * @param input - Step creation parameters (id supplied by flow)
 * @returns Result containing the created step or an error
 */
export async function createStep(
  ctx: DataContext,
  input: CreateStepInput,
): Promise<Result<Step, Error>> {
  try {
    const now = Date.now();

    const rows = await executeInsert(
      ctx.db,
      schema,
      (q, p) =>
        q
          .insertInto("step")
          .values({
            id: p.id,
            run_id: p.runId,
            stage_id: p.stageId,
            name: p.name,
            status: "pending",
            depends_on: p.dependsOn,
            retry_count: 0,
            max_retries: p.maxRetries,
            env: p.env,
            created_at: p.createdAt,
          })
          .returning((r) => r),
      {
        id: input.id, // Flow-supplied ID
        runId: input.runId,
        stageId: input.stageId,
        name: input.name,
        dependsOn: JSON.stringify(input.dependsOn),
        maxRetries: input.maxRetries,
        env: input.env ? JSON.stringify(input.env) : null,
        createdAt: now,
      },
    );

    const row = rows[0];
    if (!row) {
      return failure(new Error("Failed to create step"));
    }

    logger.info("Created step", {
      id: input.id,
      runId: input.runId,
      name: input.name,
    });

    return success(mapStepFromDb(row));
  } catch (error) {
    logger.error("Failed to create step", { error, input });
    return failure(error as Error);
  }
}
