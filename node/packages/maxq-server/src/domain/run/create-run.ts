import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { sql } from "@codespin/maxq-db";
import type { RunDbRow } from "@codespin/maxq-db";
import type { DataContext } from "../data-context.js";
import type { Run, CreateRunInput } from "../../types.js";
import { mapRunFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:run");

/**
 * Create a new run
 *
 * @param ctx - Data context containing database connection
 * @param input - Run creation parameters
 * @returns Result containing the created run or an error
 */
export async function createRun(
  ctx: DataContext,
  input: CreateRunInput,
): Promise<Result<Run, Error>> {
  try {
    const id = uuidv4();
    const now = Date.now();

    const params = {
      id,
      flow_name: input.flowName,
      status: "pending" as const,
      input: input.input || null,
      metadata: input.metadata || null,
      created_at: now,
    };

    const row = await ctx.db.one<RunDbRow>(
      `${sql.insert("run", params)} RETURNING *`,
      params,
    );

    logger.info("Created run", { id, flowName: input.flowName });

    return success(mapRunFromDb(row));
  } catch (error) {
    logger.error("Failed to create run", { error, input });
    return failure(error as Error);
  }
}
