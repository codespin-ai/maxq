import { v4 as uuidv4 } from "uuid";
import { Result, success, failure } from "@codespin/maxq-core";
import { createLogger } from "@codespin/maxq-logger";
import { sql, type ArtifactDbRow } from "@codespin/maxq-db";
import type { DataContext } from "../data-context.js";
import type { Artifact, CreateArtifactInput } from "../../types.js";
import { mapArtifactFromDb } from "../../mappers.js";

const logger = createLogger("maxq:domain:artifact");

/**
 * Create a new artifact
 *
 * @param ctx - Data context containing database connection
 * @param input - Artifact creation parameters
 * @returns Result containing the created artifact or an error
 */
export async function createArtifact(
  ctx: DataContext,
  input: CreateArtifactInput,
): Promise<Result<Artifact, Error>> {
  try {
    const id = uuidv4();
    const now = Date.now();

    // Create full path: stepName[sequence]/name
    const fullPath = `${input.stepName}[${input.sequence}]/${input.name}`;

    const params = {
      id,
      run_id: input.runId,
      step_id: input.stepId,
      step_name: input.stepName,
      sequence: input.sequence,
      name: input.name,
      full_path: fullPath,
      value: input.value,
      tags: input.tags || null,
      metadata: input.metadata || null,
      created_at: now,
    };

    const row = await ctx.db.one<ArtifactDbRow>(
      `${sql.insert("artifact", params)} RETURNING *`,
      params,
    );

    logger.info("Created artifact", {
      id,
      runId: input.runId,
      fullPath,
    });

    return success(mapArtifactFromDb(row));
  } catch (error) {
    logger.error("Failed to create artifact", { error, input });
    return failure(error as Error);
  }
}
