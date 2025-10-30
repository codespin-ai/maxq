/**
 * Mapper functions to convert between database rows (snake_case) and domain types (camelCase)
 */

import type {
  RunDbRow,
  StageDbRow,
  StepDbRow,
  RunLogDbRow,
} from "@codespin/maxq-db";
import type { Run, Stage, Step, RunLog } from "./types.js";

// Run mappers
export function mapRunFromDb(row: RunDbRow): Run {
  return {
    id: row.id,
    flowName: row.flow_name,
    status: row.status,
    input: row.input ? JSON.parse(row.input as string) : undefined,
    output: row.output ? JSON.parse(row.output as string) : undefined,
    error: row.error ? JSON.parse(row.error as string) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    flowTitle: row.flow_title ?? undefined,
    terminationReason: row.termination_reason ?? undefined,
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
  if (run.name !== undefined) dbRow.name = run.name;
  if (run.description !== undefined) dbRow.description = run.description;
  if (run.flowTitle !== undefined) dbRow.flow_title = run.flowTitle;
  if (run.terminationReason !== undefined)
    dbRow.termination_reason = run.terminationReason;

  return dbRow;
}

// Stage mappers
// Note: SQLite stores booleans as INTEGER (0/1), so we convert between number and boolean
export function mapStageFromDb(row: StageDbRow): Stage {
  return {
    id: row.id,
    runId: row.run_id,
    name: row.name,
    final: row.final === 1, // Convert SQLite INTEGER to boolean
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    terminationReason: row.termination_reason ?? undefined,
  };
}

export function mapStageToDb(stage: Partial<Stage>): Partial<StageDbRow> {
  const dbRow: Partial<StageDbRow> = {};

  if (stage.id !== undefined) dbRow.id = stage.id;
  if (stage.runId !== undefined) dbRow.run_id = stage.runId;
  if (stage.name !== undefined) dbRow.name = stage.name;
  if (stage.final !== undefined) dbRow.final = stage.final ? 1 : 0; // Convert boolean to SQLite INTEGER
  if (stage.status !== undefined) dbRow.status = stage.status;
  if (stage.createdAt !== undefined) dbRow.created_at = stage.createdAt;
  if (stage.startedAt !== undefined) dbRow.started_at = stage.startedAt;
  if (stage.completedAt !== undefined) dbRow.completed_at = stage.completedAt;
  if (stage.terminationReason !== undefined)
    dbRow.termination_reason = stage.terminationReason;

  return dbRow;
}

// Step mappers
export function mapStepFromDb(row: StepDbRow): Step {
  return {
    id: row.id,
    runId: row.run_id,
    stageId: row.stage_id,
    name: row.name,
    status: row.status,
    dependsOn: row.depends_on ? JSON.parse(row.depends_on as string) : [],
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    env: row.env ? JSON.parse(row.env as string) : undefined,
    fields: row.fields ? JSON.parse(row.fields as string) : undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? undefined,
    stderr: row.stderr ?? undefined,
    terminationReason: row.termination_reason ?? undefined,
    queuedAt: row.queued_at ?? undefined,
    claimedAt: row.claimed_at ?? undefined,
    heartbeatAt: row.heartbeat_at ?? undefined,
    workerId: row.worker_id ?? undefined,
  };
}

export function mapStepToDb(step: Partial<Step>): Partial<StepDbRow> {
  const dbRow: Partial<StepDbRow> = {};

  if (step.id !== undefined) dbRow.id = step.id;
  if (step.runId !== undefined) dbRow.run_id = step.runId;
  if (step.stageId !== undefined) dbRow.stage_id = step.stageId;
  if (step.name !== undefined) dbRow.name = step.name;
  if (step.status !== undefined) dbRow.status = step.status;
  if (step.dependsOn !== undefined) dbRow.depends_on = step.dependsOn;
  if (step.retryCount !== undefined) dbRow.retry_count = step.retryCount;
  if (step.maxRetries !== undefined) dbRow.max_retries = step.maxRetries;
  if (step.env !== undefined) dbRow.env = step.env;
  if (step.fields !== undefined) dbRow.fields = step.fields;
  if (step.error !== undefined) dbRow.error = step.error;
  if (step.createdAt !== undefined) dbRow.created_at = step.createdAt;
  if (step.startedAt !== undefined) dbRow.started_at = step.startedAt;
  if (step.completedAt !== undefined) dbRow.completed_at = step.completedAt;
  if (step.durationMs !== undefined) dbRow.duration_ms = step.durationMs;
  if (step.stdout !== undefined) dbRow.stdout = step.stdout;
  if (step.stderr !== undefined) dbRow.stderr = step.stderr;
  if (step.terminationReason !== undefined)
    dbRow.termination_reason = step.terminationReason;
  if (step.queuedAt !== undefined) dbRow.queued_at = step.queuedAt;
  if (step.claimedAt !== undefined) dbRow.claimed_at = step.claimedAt;
  if (step.heartbeatAt !== undefined) dbRow.heartbeat_at = step.heartbeatAt;
  if (step.workerId !== undefined) dbRow.worker_id = step.workerId;

  return dbRow;
}

// RunLog mappers
export function mapRunLogFromDb(row: RunLogDbRow): RunLog {
  return {
    id: row.id,
    runId: row.run_id,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined,
    level: row.level,
    message: row.message,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    createdAt: row.created_at,
  };
}

export function mapRunLogToDb(log: Partial<RunLog>): Partial<RunLogDbRow> {
  const dbRow: Partial<RunLogDbRow> = {};

  if (log.id !== undefined) dbRow.id = log.id;
  if (log.runId !== undefined) dbRow.run_id = log.runId;
  if (log.entityType !== undefined) dbRow.entity_type = log.entityType;
  if (log.entityId !== undefined) dbRow.entity_id = log.entityId;
  if (log.level !== undefined) dbRow.level = log.level;
  if (log.message !== undefined) dbRow.message = log.message;
  if (log.metadata !== undefined) dbRow.metadata = log.metadata;
  if (log.createdAt !== undefined) dbRow.created_at = log.createdAt;

  return dbRow;
}
