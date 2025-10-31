/**
 * Server types for MaxQ
 */

import type { RunStatus, StageStatus, StepStatus } from "./lib/db/index.js";

export type ServerConfig = {
  port: number;
  host: string;
  flowsRoot: string;
  databaseUrl: string;
};

// Run domain type (camelCase for API)
export type Run = {
  id: string;
  flowName: string;
  status: RunStatus;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata?: unknown;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  name?: string;
  description?: string;
  flowTitle?: string;
  terminationReason?: string;
};

// Stage domain type (camelCase for API)
export type Stage = {
  id: string;
  runId: string;
  name: string;
  final: boolean;
  status: StageStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  terminationReason?: string;
};

// Step domain type (camelCase for API)
export type Step = {
  id: string; // Unique step ID supplied by flow (e.g., "fetch-news", "analyzer-0")
  runId: string;
  stageId: string;
  name: string; // Step script directory name (e.g., "fetch_news", "analyzer")
  status: StepStatus;
  dependsOn: string[]; // Array of step IDs (not names)
  retryCount: number;
  maxRetries: number;
  env?: Record<string, string>;
  fields?: Record<string, unknown>; // Arbitrary fields posted by step
  error?: unknown;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  terminationReason?: string;
  // Scheduler fields
  queuedAt?: number;
  claimedAt?: number;
  heartbeatAt?: number;
  workerId?: string;
};

// Input types for creating entities
export type CreateRunInput = {
  flowName: string;
  input?: unknown;
  metadata?: unknown;
  flowTitle?: string; // Display title from flow.yaml
};

export type CreateStageInput = {
  runId: string;
  name: string;
  final: boolean;
};

export type CreateStepInput = {
  id: string; // Unique step ID supplied by flow (e.g., "fetch-news", "analyzer-0")
  runId: string;
  stageId: string;
  name: string; // Step script directory name (e.g., "fetch_news", "analyzer")
  dependsOn: string[]; // Array of step IDs
  maxRetries: number;
  env?: Record<string, string>;
};

// Update types
export type UpdateRunInput = {
  status?: RunStatus;
  output?: unknown;
  error?: unknown;
  startedAt?: number;
  completedAt?: number;
  stdout?: string;
  stderr?: string;
  name?: string;
  description?: string;
};

export type UpdateStageInput = {
  status?: StageStatus;
  completedAt?: number;
};

export type UpdateStepInput = {
  status?: StepStatus;
  fields?: Record<string, unknown>;
  error?: unknown;
  retryCount?: number;
  startedAt?: number;
  completedAt?: number;
  stdout?: string;
  stderr?: string;
};

// Query parameters
export type ListRunsParams = {
  flowName?: string;
  status?: RunStatus;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "completedAt";
  sortOrder?: "asc" | "desc";
};

export type ListStepsParams = {
  runId: string;
  stage?: string;
  status?: StepStatus;
  name?: string;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "completedAt";
  sortOrder?: "asc" | "desc";
};

// Run log domain type (camelCase for API)
export type RunLog = {
  id: string; // UUID
  runId: string;
  entityType: "run" | "stage" | "step";
  entityId?: string; // stage_id or step_id, null for run-level logs
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: unknown; // Additional structured data
  createdAt: number;
};

// Run log input types
export type CreateRunLogInput = {
  runId: string;
  entityType: "run" | "stage" | "step";
  entityId?: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: unknown;
};

export type ListRunLogsParams = {
  runId: string;
  entityType?: "run" | "stage" | "step";
  entityId?: string;
  level?: "debug" | "info" | "warn" | "error";
  limit?: number;
  before?: number; // created_at timestamp - logs before this time
  after?: number; // created_at timestamp - logs after this time
};

// Pagination result
export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
};
