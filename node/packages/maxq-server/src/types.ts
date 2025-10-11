/**
 * Server types for MaxQ
 */

import type { RunStatus, StageStatus, StepStatus } from "@codespin/maxq-db";

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
};

// Stage domain type (camelCase for API)
export type Stage = {
  id: string;
  runId: string;
  name: string;
  final: boolean;
  status: StageStatus;
  createdAt: number;
  completedAt?: number;
};

// Step domain type (camelCase for API)
export type Step = {
  id: string;
  runId: string;
  stageId: string;
  name: string;
  sequence: number;
  status: StepStatus;
  dependsOn: string[]; // Array of step names
  retryCount: number;
  maxRetries: number;
  env?: Record<string, string>;
  output?: unknown;
  error?: unknown;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
};

// Artifact domain type (camelCase for API)
export type Artifact = {
  id: string;
  runId: string;
  stepId: string;
  stepName: string;
  sequence: number;
  name: string;
  fullPath: string;
  value: unknown;
  tags?: string[];
  metadata?: unknown;
  createdAt: number;
};

// Input types for creating entities
export type CreateRunInput = {
  flowName: string;
  input?: unknown;
  metadata?: unknown;
};

export type CreateStageInput = {
  runId: string;
  name: string;
  final: boolean;
};

export type CreateStepInput = {
  runId: string;
  stageId: string;
  name: string;
  sequence: number;
  dependsOn: string[];
  maxRetries: number;
  env?: Record<string, string>;
};

export type CreateArtifactInput = {
  runId: string;
  stepId: string;
  stepName: string;
  sequence: number;
  name: string;
  value: unknown;
  tags?: string[];
  metadata?: unknown;
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
};

export type UpdateStageInput = {
  status?: StageStatus;
  completedAt?: number;
};

export type UpdateStepInput = {
  status?: StepStatus;
  output?: unknown;
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
  sequence?: number;
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "completedAt";
  sortOrder?: "asc" | "desc";
};

export type QueryArtifactsParams = {
  runId: string;
  stepName?: string;
  sequence?: number;
  name?: string;
  namePrefix?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  sortBy?: "createdAt";
  sortOrder?: "asc" | "desc";
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
