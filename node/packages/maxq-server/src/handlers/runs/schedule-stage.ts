import { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "@codespin/maxq-logger";
import type { IDatabase } from "pg-promise";
import type { DataContext } from "../../domain/data-context.js";
import { createStage } from "../../domain/stage/create-stage.js";
import { createStep } from "../../domain/step/create-step.js";
import { executeStepsDAG } from "../../executor/step-executor.js";
import type { StepDefinition } from "../../executor/step-executor.js";

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

      // Reject scheduling if run is aborted or completed
      if (run.status === "failed" && run.terminationReason === "aborted") {
        logger.warn("Cannot schedule stage for aborted run", {
          runId,
          stage: input.stage,
          terminationReason: run.terminationReason,
        });
        res.status(400).json({
          error: "Cannot schedule stages for aborted run",
        });
        return;
      }

      if (run.status === "completed" || run.status === "failed") {
        logger.warn("Cannot schedule stage for completed/failed run", {
          runId,
          stage: input.stage,
          status: run.status,
        });
        res.status(400).json({
          error: `Cannot schedule stages for ${run.status} run`,
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
      let createdSteps;
      try {
        const transactionResult = await ctx.db.tx(async (t) => {
          // Create transaction context with IDatabase-compatible interface
          const txCtx = { ...ctx, db: t as unknown as IDatabase<unknown> };

          // Check if stage already exists (for retry scenario)
          // Query for existing stage with this run_id and name
          const { executeSelect } = await import(
            "@webpods/tinqer-sql-pg-promise"
          );
          const { schema } = await import("@codespin/maxq-db");

          const existingStages = await executeSelect(
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
              "@webpods/tinqer-sql-pg-promise"
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
                final: input.final,
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

          const stageId = stage.id;

          // Create/reuse step records for all steps
          const createdSteps = [];
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
                "@webpods/tinqer-sql-pg-promise"
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

          return { stageId, createdSteps };
        });

        stageId = transactionResult.stageId;
        createdSteps = transactionResult.createdSteps;
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

      // Trigger step execution asynchronously
      // Don't wait for completion - steps run in background
      const stepDefinitions: StepDefinition[] = input.steps.map((step) => ({
        id: step.id,
        name: step.name,
        dependsOn: step.dependsOn,
        maxRetries: step.maxRetries,
        env: step.env,
      }));

      executeStepsDAG(
        stepDefinitions,
        runId,
        flowName,
        input.stage,
        ctx.executor.config.flowsRoot,
        ctx.executor.apiUrl,
        ctx.executor.config.maxLogCapture,
        ctx.executor.config.maxConcurrentSteps,
        ctx.executor.processRegistry,
        async (result) => {
          // Step completion callback - update step in database
          logger.debug("Step completed", {
            runId,
            stageName: input.stage,
            stepId: result.id,
            stepName: result.name,
            exitCode: result.processResult.exitCode,
          });

          // Determine status from exit code - exit code is the ONLY source of truth
          // Fields are arbitrary JSON data for inter-step communication, not status control
          const status: "completed" | "failed" =
            result.processResult.exitCode === 0 ? "completed" : "failed";

          logger.debug("Setting step status from exit code", {
            stepId: result.id,
            exitCode: result.processResult.exitCode,
            status,
            retryCount: result.retryCount,
          });

          // Update step with execution results
          const { updateStep } = await import(
            "../../domain/step/update-step.js"
          );
          const updateResult = await updateStep(ctx, result.id, {
            status,
            stdout: result.processResult.stdout,
            stderr: result.processResult.stderr,
            retryCount: result.retryCount,
            completedAt: Date.now(),
          });

          // Return the final status from DB
          if (!updateResult.success || !updateResult.data) {
            // If update failed, fall back to computed status
            return { finalStatus: status };
          }

          // Extract final status - should only be "completed" or "failed" at this point
          const finalStatus = updateResult.data.status;
          if (finalStatus !== "completed" && finalStatus !== "failed") {
            // Should never happen, but handle gracefully
            logger.warn("Unexpected step status after update", {
              stepId: result.id,
              status: finalStatus,
            });
            return { finalStatus: "failed" };
          }

          return { finalStatus };
        },
      )
        .then(async () => {
          // All steps completed successfully
          logger.info("Stage completed successfully", {
            runId,
            stageId,
            stageName: input.stage,
            final: input.final,
          });

          // Mark stage as completed
          const { updateStage } = await import(
            "../../domain/stage/update-stage.js"
          );
          const stageUpdateResult = await updateStage(ctx, stageId, {
            status: "completed",
            completedAt: Date.now(),
          });

          if (!stageUpdateResult.success) {
            logger.error("Failed to mark stage as completed", {
              runId,
              stageId,
              errorMessage: stageUpdateResult.error.message,
              errorStack: stageUpdateResult.error.stack,
            });
          }

          // If final stage, mark run as completed
          if (input.final) {
            logger.info("Final stage completed, marking run as completed", {
              runId,
            });
            const { updateRun } = await import(
              "../../domain/run/update-run.js"
            );
            const runUpdateResult = await updateRun(ctx, runId, {
              status: "completed",
              completedAt: Date.now(),
            });

            if (!runUpdateResult.success) {
              logger.error("Failed to mark run as completed", {
                runId,
                errorMessage: runUpdateResult.error.message,
                errorStack: runUpdateResult.error.stack,
              });
            }
          } else {
            // Non-final stage: call flow with MAXQ_COMPLETED_STAGE
            logger.info(
              "Non-final stage completed, calling flow for next stage",
              {
                runId,
                completedStage: input.stage,
              },
            );
            const { executeFlowStageCompleted } = await import(
              "../../executor/flow-executor.js"
            );
            await executeFlowStageCompleted({
              runId,
              flowName,
              flowsRoot: ctx.executor.config.flowsRoot,
              apiUrl: ctx.executor.apiUrl,
              maxLogCapture: ctx.executor.config.maxLogCapture,
              processRegistry: ctx.executor.processRegistry,
              completedStage: input.stage,
            });
          }
        })
        .catch(async (error) => {
          logger.error("Stage execution failed", {
            runId,
            stageId,
            stageName: input.stage,
            error,
          });

          // Mark stage as failed
          const { updateStage } = await import(
            "../../domain/stage/update-stage.js"
          );
          const stageUpdateResult = await updateStage(ctx, stageId, {
            status: "failed",
            completedAt: Date.now(),
          });

          if (!stageUpdateResult.success) {
            logger.error("Failed to mark stage as failed", {
              runId,
              stageId,
              errorMessage: stageUpdateResult.error.message,
              errorStack: stageUpdateResult.error.stack,
            });
          }

          // Call flow with MAXQ_FAILED_STAGE per spec §10.2
          logger.info("Calling flow with MAXQ_FAILED_STAGE", {
            runId,
            failedStage: input.stage,
          });
          const { executeFlowStageFailed } = await import(
            "../../executor/flow-executor.js"
          );
          try {
            await executeFlowStageFailed({
              runId,
              flowName,
              flowsRoot: ctx.executor.config.flowsRoot,
              apiUrl: ctx.executor.apiUrl,
              maxLogCapture: ctx.executor.config.maxLogCapture,
              processRegistry: ctx.executor.processRegistry,
              failedStage: input.stage,
            });
          } catch (flowError) {
            logger.error("Flow callback failed after stage failure", {
              runId,
              failedStage: input.stage,
              error: flowError,
            });
          }

          // Mark run as failed
          const { updateRun } = await import("../../domain/run/update-run.js");
          const runUpdateResult = await updateRun(ctx, runId, {
            status: "failed",
            completedAt: Date.now(),
          });

          if (!runUpdateResult.success) {
            logger.error("Failed to mark run as failed", {
              runId,
              errorMessage: runUpdateResult.error.message,
              errorStack: runUpdateResult.error.stack,
            });
          }
        });

      // Return response immediately (execution happens in background)
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
