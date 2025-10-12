import { Router } from "express";
import type { DataContext } from "../domain/data-context.js";
import { createRunHandler } from "../handlers/runs/create-run.js";
import { getRunHandler } from "../handlers/runs/get-run.js";
import { updateRunHandler } from "../handlers/runs/update-run.js";
import { listRunsHandler } from "../handlers/runs/list-runs.js";
import { scheduleStageHandler } from "../handlers/runs/schedule-stage.js";
import { postStepFieldsHandler } from "../handlers/runs/post-step-fields.js";
import { queryFieldsHandler } from "../handlers/runs/query-fields.js";

export function createRunsRouter(ctx: DataContext): Router {
  const router = Router();

  // Route definitions - handlers are curried with ctx
  router.post("/", createRunHandler(ctx));
  router.get("/:id", getRunHandler(ctx));
  router.patch("/:id", updateRunHandler(ctx));
  router.get("/", listRunsHandler(ctx));

  // Schedule stage endpoint - called by flow.sh via HTTP API
  router.post("/:runId/steps", scheduleStageHandler(ctx));

  // Query step fields endpoint - called by step.sh to retrieve upstream data
  router.get("/:runId/fields", queryFieldsHandler(ctx));

  // Post step fields endpoint - called by step.sh to report completion
  router.post("/:runId/steps/:stepId/fields", postStepFieldsHandler(ctx));

  return router;
}
