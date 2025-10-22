import { Router } from "express";
import type { DataContext } from "../domain/data-context.js";
import { createRunHandler } from "../handlers/runs/create-run.js";
import { getRunHandler } from "../handlers/runs/get-run.js";
import { updateRunHandler } from "../handlers/runs/update-run.js";
import { listRunsHandler } from "../handlers/runs/list-runs.js";
import { scheduleStageHandler } from "../handlers/runs/schedule-stage.js";
import { postStepFieldsHandler } from "../handlers/runs/post-step-fields.js";
import { queryFieldsHandler } from "../handlers/runs/query-fields.js";
import { abortRunHandler } from "../handlers/runs/abort-run.js";
import { retryRunHandler } from "../handlers/runs/retry-run.js";
import { pauseRunHandler } from "../handlers/runs/pause-run.js";
import { resumeRunHandler } from "../handlers/runs/resume-run.js";
import { retryStepHandler } from "../handlers/runs/retry-step.js";
import { createRunLogHandler } from "../handlers/runs/create-run-log.js";
import { listRunLogsHandler } from "../handlers/runs/list-run-logs.js";

export function createRunsRouter(ctx: DataContext): Router {
  const router = Router();

  // Get abort grace period from environment
  const abortGraceMs = parseInt(process.env.MAXQ_ABORT_GRACE_MS || "5000", 10);

  // Route definitions - handlers are curried with ctx
  router.post("/", createRunHandler(ctx));
  router.get("/:id", getRunHandler(ctx));
  router.patch("/:id", updateRunHandler(ctx));
  router.get("/", listRunsHandler(ctx));

  // Abort endpoint - abort a running workflow
  router.post("/:runId/abort", abortRunHandler(ctx, abortGraceMs));

  // Pause endpoint - pause a running workflow
  router.post("/:runId/pause", pauseRunHandler(ctx, abortGraceMs));

  // Resume endpoint - resume a paused workflow
  router.post("/:runId/resume", resumeRunHandler(ctx));

  // Retry endpoint - retry a failed or aborted workflow
  router.post("/:runId/retry", retryRunHandler(ctx));

  // Retry step endpoint - retry a specific failed step
  router.post("/:runId/steps/:stepId/retry", retryStepHandler(ctx));

  // Run logs endpoints - create and list run logs
  router.post("/:runId/logs", createRunLogHandler(ctx));
  router.get("/:runId/logs", listRunLogsHandler(ctx));

  // Schedule stage endpoint - called by flow.sh via HTTP API
  router.post("/:runId/steps", scheduleStageHandler(ctx));

  // Query step fields endpoint - called by step.sh to retrieve upstream data
  router.get("/:runId/fields", queryFieldsHandler(ctx));

  // Post step fields endpoint - called by step.sh to report completion
  router.post("/:runId/steps/:stepId/fields", postStepFieldsHandler(ctx));

  return router;
}
