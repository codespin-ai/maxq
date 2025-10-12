import { Request, Response } from "express";
import { z } from "zod";
import { createLogger } from "@codespin/maxq-logger";
import type { DataContext } from "../../domain/data-context.js";
import { createStage } from "../../domain/stage/create-stage.js";
import { createStep } from "../../domain/step/create-step.js";
import { executeStepsDAG } from "../../executor/step-executor.js";
import type { StepDefinition } from "../../executor/step-executor.js";

const logger = createLogger("maxq:handlers:runs:schedule-stage");

// Validation schema matching spec 6.4.5
const stepSchema = z.object({
  id: z.string().min(1), // Unique step ID supplied by flow
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

      logger.info("Scheduling stage", {
        runId,
        stage: input.stage,
        final: input.final,
        stepCount: input.steps.length,
      });

      // Create stage record
      const stageResult = await createStage(ctx, {
        runId,
        name: input.stage,
        final: input.final,
      });

      if (!stageResult.success) {
        logger.error("Failed to create stage", {
          runId,
          stage: input.stage,
          error: stageResult.error,
        });
        res.status(500).json({ error: stageResult.error.message });
        return;
      }

      const stage = stageResult.data;
      const stageId = stage.id;

      // Create step records for all steps
      const createdSteps = [];
      for (const stepDef of input.steps) {
        const stepResult = await createStep(ctx, {
          id: stepDef.id, // Flow-supplied unique ID
          runId,
          stageId,
          name: stepDef.name,
          dependsOn: stepDef.dependsOn || [],
          maxRetries: stepDef.maxRetries || 0,
          env: stepDef.env,
        });

        if (!stepResult.success) {
          logger.error("Failed to create step", {
            runId,
            stageId,
            stepId: stepDef.id,
            stepName: stepDef.name,
            error: stepResult.error,
          });
          res.status(500).json({ error: stepResult.error.message });
          return;
        }

        createdSteps.push(stepResult.data);
      }

      logger.info("Created stage and steps", {
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

      // TODO: Get flowName from run record
      // For now, we need to fetch the run to get flowName
      const { getRun } = await import("../../domain/run/get-run.js");
      const runResult = await getRun(ctx, runId);
      if (!runResult.success || !runResult.data) {
        logger.error("Failed to get run for step execution", { runId });
        res.status(500).json({ error: "Failed to get run" });
        return;
      }

      const flowName = runResult.data.flowName;

      executeStepsDAG(
        stepDefinitions,
        runId,
        flowName,
        input.stage,
        ctx.executor.config.flowsRoot,
        ctx.executor.apiUrl,
        ctx.executor.config.maxLogCapture,
        ctx.executor.config.maxConcurrentSteps,
        async (result) => {
          // Step completion callback - update step in database
          logger.debug("Step completed", {
            runId,
            stageName: input.stage,
            stepId: result.id,
            stepName: result.name,
            exitCode: result.processResult.exitCode,
          });

          // Update step with execution results
          const { updateStep } = await import(
            "../../domain/step/update-step.js"
          );
          const status =
            result.processResult.exitCode === 0 ? "completed" : "failed";
          await updateStep(ctx, result.id, {
            status,
            stdout: result.processResult.stdout,
            stderr: result.processResult.stderr,
            retryCount: result.retryCount,
            completedAt: Date.now(),
          });
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
          await updateStage(ctx, stageId, {
            status: "completed",
            completedAt: Date.now(),
          });

          // If final stage, mark run as completed
          if (input.final) {
            logger.info("Final stage completed, marking run as completed", {
              runId,
            });
            const { updateRun } = await import(
              "../../domain/run/update-run.js"
            );
            await updateRun(ctx, runId, {
              status: "completed",
              completedAt: Date.now(),
            });
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
          await updateStage(ctx, stageId, {
            status: "failed",
            completedAt: Date.now(),
          });

          // Mark run as failed
          const { updateRun } = await import("../../domain/run/update-run.js");
          await updateRun(ctx, runId, {
            status: "failed",
            completedAt: Date.now(),
          });
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
