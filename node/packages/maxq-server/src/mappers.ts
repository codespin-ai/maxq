/**
 * Mapper functions to convert between database rows (snake_case) and domain types (camelCase)
 */

import type {
  RunDbRow,
  StageDbRow,
  StepDbRow,
  ArtifactDbRow,
} from "@codespin/maxq-db";
import type { Run, Stage, Step, Artifact } from "./types.js";

// Run mappers
export function mapRunFromDb(row: RunDbRow): Run {
  return {
    id: row.id,
    flowName: row.flow_name,
    status: row.status,
    input: row.input ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
  };
}

export function mapRunToDb(run: Partial<Run>): Partial<RunDbRow> {
  const dbRow: Partial<RunDbRow> = {};

  if (run.id !== undefined) dbRow.id = run.id;
  if (run.flowName !== undefined) dbRow.flow_name = run.flowName;
  if (run.status !== undefined) dbRow.status = run.status;
  if (run.input !== undefined) dbRow.input = run.input;
  if (run.output !== undefined) dbRow.output = run.output;
  if (run.error !== undefined) dbRow.error = run.error;
  if (run.metadata !== undefined) dbRow.metadata = run.metadata;
  if (run.createdAt !== undefined) dbRow.created_at = run.createdAt;
  if (run.startedAt !== undefined) dbRow.started_at = run.startedAt;
  if (run.completedAt !== undefined) dbRow.completed_at = run.completedAt;
  if (run.durationMs !== undefined) dbRow.duration_ms = run.durationMs;
  if (run.stdout !== undefined) dbRow.stdout = run.stdout;
  if (run.stderr !== undefined) dbRow.stderr = run.stderr;

  return dbRow;
}

// Stage mappers
export function mapStageFromDb(row: StageDbRow): Stage {
  return {
    id: row.id,
    runId: row.run_id,
    name: row.name,
    final: row.final,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function mapStageToDb(stage: Partial<Stage>): Partial<StageDbRow> {
  const dbRow: Partial<StageDbRow> = {};

  if (stage.id !== undefined) dbRow.id = stage.id;
  if (stage.runId !== undefined) dbRow.run_id = stage.runId;
  if (stage.name !== undefined) dbRow.name = stage.name;
  if (stage.final !== undefined) dbRow.final = stage.final;
  if (stage.status !== undefined) dbRow.status = stage.status;
  if (stage.createdAt !== undefined) dbRow.created_at = stage.createdAt;
  if (stage.completedAt !== undefined) dbRow.completed_at = stage.completedAt;

  return dbRow;
}

// Step mappers
export function mapStepFromDb(row: StepDbRow): Step {
  return {
    id: row.id,
    runId: row.run_id,
    stageId: row.stage_id,
    name: row.name,
    sequence: row.sequence,
    status: row.status,
    dependsOn: (row.depends_on as string[]) || [],
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    env: row.env as Record<string, string> | undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
  };
}

export function mapStepToDb(step: Partial<Step>): Partial<StepDbRow> {
  const dbRow: Partial<StepDbRow> = {};

  if (step.id !== undefined) dbRow.id = step.id;
  if (step.runId !== undefined) dbRow.run_id = step.runId;
  if (step.stageId !== undefined) dbRow.stage_id = step.stageId;
  if (step.name !== undefined) dbRow.name = step.name;
  if (step.sequence !== undefined) dbRow.sequence = step.sequence;
  if (step.status !== undefined) dbRow.status = step.status;
  if (step.dependsOn !== undefined) dbRow.depends_on = step.dependsOn;
  if (step.retryCount !== undefined) dbRow.retry_count = step.retryCount;
  if (step.maxRetries !== undefined) dbRow.max_retries = step.maxRetries;
  if (step.env !== undefined) dbRow.env = step.env;
  if (step.output !== undefined) dbRow.output = step.output;
  if (step.error !== undefined) dbRow.error = step.error;
  if (step.createdAt !== undefined) dbRow.created_at = step.createdAt;
  if (step.startedAt !== undefined) dbRow.started_at = step.startedAt;
  if (step.completedAt !== undefined) dbRow.completed_at = step.completedAt;
  if (step.durationMs !== undefined) dbRow.duration_ms = step.durationMs;
  if (step.stdout !== undefined) dbRow.stdout = step.stdout;
  if (step.stderr !== undefined) dbRow.stderr = step.stderr;

  return dbRow;
}

// Artifact mappers
export function mapArtifactFromDb(row: ArtifactDbRow): Artifact {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    stepName: row.step_name,
    sequence: row.sequence,
    name: row.name,
    fullPath: row.full_path,
    value: row.value,
    tags: row.tags ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at,
  };
}

export function mapArtifactToDb(
  artifact: Partial<Artifact>,
): Partial<ArtifactDbRow> {
  const dbRow: Partial<ArtifactDbRow> = {};

  if (artifact.id !== undefined) dbRow.id = artifact.id;
  if (artifact.runId !== undefined) dbRow.run_id = artifact.runId;
  if (artifact.stepId !== undefined) dbRow.step_id = artifact.stepId;
  if (artifact.stepName !== undefined) dbRow.step_name = artifact.stepName;
  if (artifact.sequence !== undefined) dbRow.sequence = artifact.sequence;
  if (artifact.name !== undefined) dbRow.name = artifact.name;
  if (artifact.fullPath !== undefined) dbRow.full_path = artifact.fullPath;
  if (artifact.value !== undefined) dbRow.value = artifact.value;
  if (artifact.tags !== undefined) dbRow.tags = artifact.tags;
  if (artifact.metadata !== undefined) dbRow.metadata = artifact.metadata;
  if (artifact.createdAt !== undefined) dbRow.created_at = artifact.createdAt;

  return dbRow;
}
