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
  name?: string;
  description?: string;
  flowTitle?: string;
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

// Pagination result
export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
};
