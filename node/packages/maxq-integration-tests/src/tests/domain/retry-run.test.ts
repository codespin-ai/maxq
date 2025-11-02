/**
 * Unit tests for retry-run domain logic
 * These tests verify that retry properly clears all fields without relying on timing
 *
 * NOTE: These tests verify the database state immediately after retryRun() completes.
 * The orchestrator runs asynchronously (.catch()), so we can verify the retry logic
 * cleared all fields before the orchestrator starts executing steps.
 */

import { expect } from "chai";
import { testDb } from "../../test-setup.js";
import { retryRun } from "maxq/src/domain/run/retry-run.js";
import type { DataContext } from "maxq/src/domain/data-context.js";
import { StepProcessRegistry } from "maxq/src/executor/process-registry.js";

// Type definitions for database query results
type StepQueueFieldsQueryResult = {
  status: string;
  queued_at: number;
  claimed_at: number;
  heartbeat_at: number;
  worker_id: string;
};

type StepFullQueryResult = {
  status: string;
  queued_at: number | null;
  claimed_at: number | null;
  heartbeat_at: number | null;
  worker_id: string | null;
  retry_count: number;
  termination_reason: string | null;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
  stdout: string | null;
  stderr: string | null;
  fields: string | null;
  error: string | null;
};

type RunTerminationQueryResult = {
  status: string;
  termination_reason: string;
  completed_at: number;
};

type RunClearedQueryResult = {
  termination_reason: string | null;
  completed_at: number | null;
};

type StageQueryResult = {
  status: string;
  started_at: number;
  completed_at: number;
  termination_reason: string;
};

type StageClearedQueryResult = {
  status: string;
  started_at: number | null;
  completed_at: number | null;
  termination_reason: string | null;
};

type StepCompletedQueryResult = {
  status: string;
  started_at: number;
  completed_at: number;
  stdout: string;
};

type StepRetryQueryResult = {
  status: string;
  retry_count: number;
  termination_reason: string | null;
};

describe("Retry Run Unit Tests", () => {
  beforeEach(async () => {
    await testDb.truncateAllTables();
  });

  it("should clear all step queue fields when retrying", async () => {
    const runId = "run-1";
    const stageId = "stage-1";
    const stepId = "step-1";
    const db = testDb.getDb();

    // Insert run first (required for foreign key)
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at, termination_reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(runId, "test-flow", "failed", Date.now(), "aborted");

    // Create run with failed step that has stale queue data
    await testDb.insertStage({
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "failed",
      created_at: Date.now(),
      termination_reason: "aborted",
    });

    await testDb.insertStep({
      id: stepId,
      run_id: runId,
      stage_id: stageId,
      name: "test-step",
      status: "failed",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: Date.now(),
      termination_reason: "aborted",
    });

    // Simulate stale queue data from before abort
    // This is what would happen if a step was running, then aborted, but queue fields weren't cleared
    db.prepare(
      `UPDATE step SET
        queued_at = ?,
        claimed_at = ?,
        heartbeat_at = ?,
        worker_id = ?
       WHERE id = ?`,
    ).run(1000, 1001, 1002, "old-worker", stepId);

    // Verify stale data is present
    const beforeRetry = db
      .prepare(
        `SELECT status, queued_at, claimed_at, heartbeat_at, worker_id
         FROM step WHERE id = ?`,
      )
      .get(stepId) as StepQueueFieldsQueryResult;

    expect(beforeRetry.status).to.equal("failed");
    expect(beforeRetry.queued_at).to.equal(1000); // Stale value
    expect(beforeRetry.claimed_at).to.equal(1001); // Stale value
    expect(beforeRetry.heartbeat_at).to.equal(1002); // Stale value
    expect(beforeRetry.worker_id).to.equal("old-worker"); // Stale value

    // Create minimal DataContext for retry
    const ctx: DataContext = {
      db,
      executor: {
        config: {
          flowsRoot: "/tmp/test-flows",
          maxLogCapture: 8192,
          maxConcurrentSteps: 10,
        },
        apiUrl: "http://localhost:5099",
        processRegistry: new StepProcessRegistry(),
      },
    };

    // Call retry
    const result = await retryRun(ctx, runId);

    // Verify retry succeeded
    expect(result.success).to.be.true;

    // Verify queue fields were cleared
    const afterRetry = db
      .prepare(
        `SELECT status, queued_at, claimed_at, heartbeat_at, worker_id, retry_count,
                termination_reason, started_at, completed_at, duration_ms, stdout, stderr,
                fields, error
         FROM step WHERE id = ?`,
      )
      .get(stepId) as StepFullQueryResult;

    expect(afterRetry.status).to.equal("pending");
    expect(afterRetry.queued_at).to.be.null; // ← CLEARED
    expect(afterRetry.claimed_at).to.be.null; // ← CLEARED
    expect(afterRetry.heartbeat_at).to.be.null; // ← CLEARED
    expect(afterRetry.worker_id).to.be.null; // ← CLEARED
    expect(afterRetry.retry_count).to.equal(0); // Reset
    expect(afterRetry.termination_reason).to.be.null; // Cleared
    expect(afterRetry.started_at).to.be.null; // Cleared
    expect(afterRetry.completed_at).to.be.null; // Cleared
    expect(afterRetry.duration_ms).to.be.null; // Cleared
    expect(afterRetry.stdout).to.be.null; // Cleared
    expect(afterRetry.stderr).to.be.null; // Cleared
    expect(afterRetry.fields).to.be.null; // Cleared
    expect(afterRetry.error).to.be.null; // Cleared
  });

  it("should clear run termination_reason when retrying", async () => {
    const runId = "run-2";
    const db = testDb.getDb();

    // Create run with termination_reason
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at, termination_reason, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(runId, "test-flow", "failed", Date.now(), "aborted", Date.now());

    // Verify termination_reason is present
    const beforeRetry = db
      .prepare(
        `SELECT status, termination_reason, completed_at FROM run WHERE id = ?`,
      )
      .get(runId) as RunTerminationQueryResult;

    expect(beforeRetry.status).to.equal("failed");
    expect(beforeRetry.termination_reason).to.equal("aborted");
    expect(beforeRetry.completed_at).to.not.be.null;

    // Create minimal DataContext
    const ctx: DataContext = {
      db,
      executor: {
        config: {
          flowsRoot: "/tmp/test-flows",
          maxLogCapture: 8192,
          maxConcurrentSteps: 10,
        },
        apiUrl: "http://localhost:5099",
        processRegistry: new StepProcessRegistry(),
      },
    };

    // Call retry
    const result = await retryRun(ctx, runId);

    // Verify retry succeeded
    expect(result.success).to.be.true;

    // Verify run fields were cleared
    // NOTE: We don't check status here because the orchestrator may have already
    // started and changed it from "pending" to "running". We only care that
    // termination_reason and completed_at were cleared by the retry logic.
    const afterRetry = db
      .prepare(`SELECT termination_reason, completed_at FROM run WHERE id = ?`)
      .get(runId) as RunClearedQueryResult;

    expect(afterRetry.termination_reason).to.be.null; // ← CLEARED
    expect(afterRetry.completed_at).to.be.null; // ← CLEARED
  });

  it("should clear stage fields when retrying", async () => {
    const runId = "run-3";
    const stageId = "stage-3";
    const db = testDb.getDb();

    // Create run
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at, termination_reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(runId, "test-flow", "failed", Date.now(), "aborted");

    // Create stage with stale timing data
    await testDb.insertStage({
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "failed",
      created_at: Date.now(),
      started_at: 5000,
      completed_at: 6000,
      termination_reason: "aborted",
    });

    // Verify stale data is present
    const beforeRetry = db
      .prepare(
        `SELECT status, started_at, completed_at, termination_reason
         FROM stage WHERE id = ?`,
      )
      .get(stageId) as StageQueryResult;

    expect(beforeRetry.status).to.equal("failed");
    expect(beforeRetry.started_at).to.equal(5000); // Stale
    expect(beforeRetry.completed_at).to.equal(6000); // Stale
    expect(beforeRetry.termination_reason).to.equal("aborted");

    // Create minimal DataContext
    const ctx: DataContext = {
      db,
      executor: {
        config: {
          flowsRoot: "/tmp/test-flows",
          maxLogCapture: 8192,
          maxConcurrentSteps: 10,
        },
        apiUrl: "http://localhost:5099",
        processRegistry: new StepProcessRegistry(),
      },
    };

    // Call retry
    const result = await retryRun(ctx, runId);

    // Verify retry succeeded
    expect(result.success).to.be.true;

    // Verify stage fields were cleared
    const afterRetry = db
      .prepare(
        `SELECT status, started_at, completed_at, termination_reason
         FROM stage WHERE id = ?`,
      )
      .get(stageId) as StageClearedQueryResult;

    expect(afterRetry.status).to.equal("pending");
    expect(afterRetry.started_at).to.be.null; // ← CLEARED
    expect(afterRetry.completed_at).to.be.null; // ← CLEARED
    expect(afterRetry.termination_reason).to.be.null; // ← CLEARED
  });

  it("should not clear completed steps", async () => {
    const runId = "run-4";
    const stageId = "stage-4";
    const completedStepId = "completed-step";
    const failedStepId = "failed-step";
    const db = testDb.getDb();

    // Create run
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at, termination_reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(runId, "test-flow", "failed", Date.now(), "aborted");

    // Create stage
    await testDb.insertStage({
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "failed",
      created_at: Date.now(),
      termination_reason: "aborted",
    });

    // Create a completed step (should NOT be reset)
    await testDb.insertStep({
      id: completedStepId,
      run_id: runId,
      stage_id: stageId,
      name: "completed-step",
      status: "completed",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: Date.now(),
      started_at: 1000,
      completed_at: 2000,
      stdout: "completed successfully",
    });

    // Create a failed step (should be reset)
    await testDb.insertStep({
      id: failedStepId,
      run_id: runId,
      stage_id: stageId,
      name: "failed-step",
      status: "failed",
      depends_on: [],
      retry_count: 1,
      max_retries: 2,
      created_at: Date.now(),
      termination_reason: "aborted",
    });

    // Create minimal DataContext
    const ctx: DataContext = {
      db,
      executor: {
        config: {
          flowsRoot: "/tmp/test-flows",
          maxLogCapture: 8192,
          maxConcurrentSteps: 10,
        },
        apiUrl: "http://localhost:5099",
        processRegistry: new StepProcessRegistry(),
      },
    };

    // Call retry
    const result = await retryRun(ctx, runId);
    expect(result.success).to.be.true;

    // Verify completed step was NOT modified
    const completedStep = db
      .prepare(
        `SELECT status, started_at, completed_at, stdout
         FROM step WHERE id = ?`,
      )
      .get(completedStepId) as StepCompletedQueryResult;

    expect(completedStep.status).to.equal("completed"); // NOT changed
    expect(completedStep.started_at).to.equal(1000); // NOT cleared
    expect(completedStep.completed_at).to.equal(2000); // NOT cleared
    expect(completedStep.stdout).to.equal("completed successfully"); // NOT cleared

    // Verify failed step WAS reset
    const failedStep = db
      .prepare(
        `SELECT status, retry_count, termination_reason
         FROM step WHERE id = ?`,
      )
      .get(failedStepId) as StepRetryQueryResult;

    expect(failedStep.status).to.equal("pending"); // Changed
    expect(failedStep.retry_count).to.equal(0); // Reset
    expect(failedStep.termination_reason).to.be.null; // Cleared
  });

  it("should reject retry for completed runs", async () => {
    const runId = "run-5";
    const db = testDb.getDb();

    // Create completed run
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(runId, "test-flow", "completed", Date.now(), Date.now());

    // Create minimal DataContext
    const ctx: DataContext = {
      db,
      executor: {
        config: {
          flowsRoot: "/tmp/test-flows",
          maxLogCapture: 8192,
          maxConcurrentSteps: 10,
        },
        apiUrl: "http://localhost:5099",
        processRegistry: new StepProcessRegistry(),
      },
    };

    // Call retry
    const result = await retryRun(ctx, runId);

    // Verify retry failed
    expect(result.success).to.be.false;
    if (!result.success) {
      expect(result.error.message).to.include("cannot be retried");
      expect(result.error.message).to.include("completed");
    }
  });
});
