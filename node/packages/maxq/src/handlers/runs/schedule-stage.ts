import { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "../../lib/logger/index.js";
import type { DataContext } from "../../domain/data-context.js";
import type { Step } from "../../types.js";
import { createStage } from "../../domain/stage/create-stage.js";
import { createStep } from "../../domain/step/create-step.js";

const logger = createLogger("maxq:handlers:runs:schedule-stage");

// Validation schema matching spec 6.4.5
const stepSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Step ID must contain only alphanumeric characters, hyphens, and underscores",
    ), // Unique step ID supplied by flow - spec §6.4.5
  name: z.string().min(1), // Script directory name
  dependsOn: z.array(z.string()).optional().default([]), // Array of step IDs
  maxRetries: z.number().int().min(0).default(0),
  env: z.record(z.string()).optional(),
});

export const scheduleStageSchema = z.object({
  stage: z.string().min(1),
  final: z.boolean(),
  steps: z.array(stepSchema),
});

/**
 * POST /api/v1/runs/:runId/steps - Schedule a stage with steps
 * Called by flow.sh via HTTP API to schedule stages
 */
export function scheduleStageHandler(ctx: DataContext) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: "Missing runId parameter" });
        return;
      }

      const input = scheduleStageSchema.parse(req.body);

      // Validate that all step IDs are unique
      const stepIds = input.steps.map((s) => s.id);
      const uniqueIds = new Set(stepIds);
      if (stepIds.length !== uniqueIds.size) {
        res.status(400).json({
          error: "Duplicate step IDs detected - all step IDs must be unique",
        });
        return;
      }

      // Validate that dependsOn references valid step IDs in this stage
      const validIds = new Set(stepIds);
      for (const step of input.steps) {
        for (const depId of step.dependsOn) {
          if (!validIds.has(depId)) {
            res.status(400).json({
              error: `Step "${step.id}" depends on unknown step ID "${depId}"`,
            });
            return;
          }
        }
      }

      // Validate run exists before creating any records
      const { getRun } = await import("../../domain/run/get-run.js");
      const runResult = await getRun(ctx, runId);
      if (!runResult.success) {
        logger.error("Failed to fetch run", { runId, error: runResult.error });
        res.status(500).json({ error: "Failed to fetch run" });
        return;
      }
      if (!runResult.data) {
        logger.warn("Run not found", { runId });
        res.status(404).json({ error: "Run not found" });
        return;
      }

      const run = runResult.data;
      const flowName = run.flowName;

      // Reject scheduling if run was terminated (aborted, server restart, etc.)
      // Allow natural failures to schedule compensating stages
      if (run.terminationReason != null) {
        logger.warn("Cannot schedule stage for terminated run", {
          runId,
          stage: input.stage,
          terminationReason: run.terminationReason,
        });
        res.status(400).json({
          error: `Cannot schedule stages for terminated run (${run.terminationReason})`,
        });
        return;
      }

      // Reject scheduling if run is completed
      if (run.status === "completed") {
        logger.warn("Cannot schedule stage for completed run", {
          runId,
          stage: input.stage,
        });
        res.status(400).json({
          error: "Run already completed",
        });
        return;
      }

      logger.info("Scheduling stage", {
        runId,
        flowName,
        stage: input.stage,
        final: input.final,
        stepCount: input.steps.length,
      });

      // Create stage and steps in a transaction to ensure atomicity
      // If any part fails, the entire operation rolls back
      let stageId: string;
      let createdSteps: Step[];
      try {
        // SQLite transaction using manual BEGIN/COMMIT
        ctx.db.prepare("BEGIN").run();
        try {
          // Transaction context uses the same database connection
          const txCtx = { ...ctx };

          // Check if stage already exists (for retry scenario)
          // Query for existing stage with this run_id and name
          const { executeSelect } = await import(
            "@tinqerjs/better-sqlite3-adapter"
          );
          const { schema } = await import("../../lib/db/index.js");

          const existingStages = executeSelect(
            txCtx.db,
            schema,
            (q, p) =>
              q
                .from("stage")
                .where((s) => s.run_id === p.runId && s.name === p.name),
            { runId, name: input.stage },
          );

          let stage;
          if (existingStages.length > 0) {
            // Stage exists - reuse it by resetting to pending
            const existingStage = existingStages[0]!;
            logger.info("Reusing existing stage", {
              runId,
              stageId: existingStage.id,
              name: input.stage,
              previousStatus: existingStage.status,
            });

            const { executeUpdate } = await import(
              "@tinqerjs/better-sqlite3-adapter"
            );
            const { mapStageFromDb } = await import("../../mappers.js");

            await executeUpdate(
              txCtx.db,
              schema,
              (q, p) =>
                q
                  .update("stage")
                  .set({
                    status: "pending",
                    final: p.final,
                    started_at: null,
                    completed_at: null,
                    termination_reason: null,
                  })
                  .where((s) => s.id === p.stageId),
              {
                stageId: existingStage.id,
                final: input.final ? 1 : 0, // Convert boolean to SQLite INTEGER
              },
            );

            // Fetch updated stage
            const updatedStages = await executeSelect(
              txCtx.db,
              schema,
              (q, p) => q.from("stage").where((s) => s.id === p.stageId),
              { stageId: existingStage.id },
            );

            stage = mapStageFromDb(updatedStages[0]!);
          } else {
            // Stage doesn't exist - create new one
            const stageResult = await createStage(txCtx, {
              runId,
              name: input.stage,
              final: input.final,
            });

            if (!stageResult.success) {
              throw new Error(
                `Failed to create stage: ${stageResult.error.message}`,
              );
            }

            stage = stageResult.data;
          }

          stageId = stage.id;

          // Create/reuse step records for all steps
          createdSteps = [];
          for (const stepDef of input.steps) {
            // Check if step already exists (for retry scenario)
            const existingSteps = await executeSelect(
              txCtx.db,
              schema,
              (q, p) =>
                q
                  .from("step")
                  .where((s) => s.run_id === p.runId && s.id === p.stepId),
              { runId, stepId: stepDef.id },
            );

            let step;
            if (existingSteps.length > 0) {
              // Step exists - reuse it by resetting to pending
              const existingStep = existingSteps[0]!;
              logger.info("Reusing existing step", {
                runId,
                stageId,
                stepId: stepDef.id,
                stepName: stepDef.name,
                previousStatus: existingStep.status,
              });

              const { executeUpdate } = await import(
                "@tinqerjs/better-sqlite3-adapter"
              );
              const { mapStepFromDb } = await import("../../mappers.js");

              await executeUpdate(
                txCtx.db,
                schema,
                (q, p) =>
                  q
                    .update("step")
                    .set({
                      status: "pending",
                      stage_id: p.stageId,
                      name: p.name,
                      depends_on: p.dependsOn,
                      max_retries: p.maxRetries,
                      env: p.env,
                      retry_count: 0,
                      started_at: null,
                      completed_at: null,
                      duration_ms: null,
                      stdout: null,
                      stderr: null,
                      termination_reason: null,
                      fields: null,
                      error: null,
                    })
                    .where((s) => s.id === p.stepId),
                {
                  stepId: stepDef.id,
                  stageId,
                  name: stepDef.name,
                  dependsOn: JSON.stringify(stepDef.dependsOn || []), // Must stringify for JSONB column
                  maxRetries: stepDef.maxRetries || 0,
                  env: stepDef.env ? JSON.stringify(stepDef.env) : null, // Must stringify for JSONB column
                },
              );

              // Fetch updated step
              const updatedSteps = await executeSelect(
                txCtx.db,
                schema,
                (q, p) => q.from("step").where((s) => s.id === p.stepId),
                { stepId: stepDef.id },
              );

              step = mapStepFromDb(updatedSteps[0]!);
            } else {
              // Step doesn't exist - create new one
              const stepResult = await createStep(txCtx, {
                id: stepDef.id, // Flow-supplied unique ID
                runId,
                stageId,
                name: stepDef.name,
                dependsOn: stepDef.dependsOn || [],
                maxRetries: stepDef.maxRetries || 0,
                env: stepDef.env,
              });

              if (!stepResult.success) {
                throw new Error(
                  `Failed to create step ${stepDef.id}: ${stepResult.error.message}`,
                );
              }

              step = stepResult.data;
            }

            createdSteps.push(step);
          }

          // Commit transaction
          ctx.db.prepare("COMMIT").run();
        } catch (innerError) {
          // Rollback on error
          ctx.db.prepare("ROLLBACK").run();
          throw innerError;
        }
      } catch (error) {
        logger.error("Transaction failed, rolled back", {
          runId,
          stage: input.stage,
          error,
        });
        res.status(500).json({
          error: "Failed to create stage and steps",
          details: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      logger.info("Created stage and steps atomically", {
        runId,
        stageId,
        stageName: input.stage,
        stepCount: createdSteps.length,
      });

      // Enqueue all steps for scheduler to pick up
      // Set queued_at timestamp so scheduler knows they're ready
      const now = Date.now();
      const { executeUpdate } = await import(
        "@tinqerjs/better-sqlite3-adapter"
      );
      const { schema } = await import("../../lib/db/index.js");

      for (const step of createdSteps) {
        await executeUpdate(
          ctx.db,
          schema,
          (q, p) =>
            q
              .update("step")
              .set({ queued_at: p.queuedAt })
              .where((s) => s.id === p.stepId),
          { stepId: step.id, queuedAt: now },
        );
      }

      logger.info("Enqueued steps for scheduler", {
        runId,
        stageId,
        stepCount: createdSteps.length,
      });

      // Return response immediately - scheduler will handle execution
      res.status(201).json({
        stage: input.stage,
        scheduled: createdSteps.length,
        steps: createdSteps.map((step) => ({
          id: step.id,
          name: step.name,
          status: step.status,
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Invalid request", details: error.errors });
        return;
      }
      logger.error("Failed to schedule stage", { error });
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
