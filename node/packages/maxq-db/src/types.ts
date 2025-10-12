/**
 * Database types for MaxQ
 */

// Database configuration
export type DatabaseConfig =
  | { type: "postgres"; connectionString: string }
  | { type: "sqlite"; path: string };

// Run status values
export type RunStatus = "pending" | "running" | "completed" | "failed";

// Stage status values
export type StageStatus = "pending" | "running" | "completed" | "failed";

// Step status values
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// Run table row (exact database schema with snake_case)
export type RunDbRow = {
  id: string;
  flow_name: string;
  status: RunStatus;
  input: unknown | null;
  output: unknown | null;
  error: unknown | null;
  metadata: unknown | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  name: string | null;
  description: string | null;
  flow_title: string | null;
};

// Stage table row (exact database schema with snake_case)
export type StageDbRow = {
  id: string;
  run_id: string;
  name: string;
  final: boolean;
  status: StageStatus;
  created_at: number;
  completed_at: number | null;
};

// Step table row (exact database schema with snake_case)
export type StepDbRow = {
  id: string; // Unique step ID supplied by flow (e.g., "fetch-news", "analyzer-0")
  run_id: string;
  stage_id: string;
  name: string; // Step script directory name (e.g., "fetch_news", "analyzer")
  status: StepStatus;
  depends_on: unknown; // Array of step IDs (JSONB)
  retry_count: number;
  max_retries: number;
  env: unknown | null; // Environment variables (JSONB)
  fields: unknown | null; // Step fields posted via POST /runs/{runId}/steps/{stepId}/fields (JSONB)
  error: unknown | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
};

// Complete database schema for Tinqer
export type DatabaseSchema = {
  run: RunDbRow;
  stage: StageDbRow;
  step: StepDbRow;
};
