import { Router } from "express";
import type { DataContext } from "../domain/data-context.js";
import { createRunHandler } from "../handlers/runs/create-run.js";
import { getRunHandler } from "../handlers/runs/get-run.js";
import { updateRunHandler } from "../handlers/runs/update-run.js";
import { listRunsHandler } from "../handlers/runs/list-runs.js";

export function createRunsRouter(ctx: DataContext): Router {
  const router = Router();

  // Route definitions - handlers are curried with ctx
  router.post("/", createRunHandler(ctx));
  router.get("/:id", getRunHandler(ctx));
  router.patch("/:id", updateRunHandler(ctx));
  router.get("/", listRunsHandler(ctx));

  return router;
}
