/**
 * Unit tests for step scheduler
 * These tests verify the scheduler correctly filters steps based on queued_at
 *
 * REGRESSION TEST: Verifies scheduler only picks up steps where queued_at IS NOT NULL
 * This guards against the bug where steps were executed before being properly queued.
 */

import { expect } from "chai";
import { testDb, testServer, defaultFlowsRoot } from "../../test-setup.js";
import {
  truncateAllTables,
  insertStage,
  insertStep,
  reconfigureTestServer,
} from "maxq-test-utils";
import {
  pickAndClaimSteps,
  type SchedulerConfig,
} from "maxq/src/scheduler/step-scheduler.js";
import type { DataContext } from "maxq/src/domain/data-context.js";
import { StepProcessRegistry } from "maxq/src/executor/process-registry.js";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "fs";
import { join } from "path";

// Type definitions for database query results
type StepStatusQueryResult = {
  status: string;
  queued_at: number | null;
  claimed_at: number | null;
};

type StepClaimQueryResult = {
  status: string;
  claimed_at: number | null;
};

describe("Step Scheduler Unit Tests", function () {
  this.timeout(10000);

  let ctx: DataContext;
  let config: SchedulerConfig;

  // Disable the test server's scheduler to prevent it from racing with
  // the unit test's direct pickAndClaimSteps calls on the shared DB.
  // Also create step scripts so background execution doesn't error.
  before(async function () {
    this.timeout(15000);
    await reconfigureTestServer(testServer, {
      maxConcurrentSteps: 0,
      flowsRoot: defaultFlowsRoot,
    });

    const stepNames = ["test-step", "not-queued", "queued", "completed"];
    const stepScript = "#!/bin/bash\nexit 0\n";
    for (const name of stepNames) {
      const stepDir = join(defaultFlowsRoot, "test-flow", "steps", name);
      if (!existsSync(stepDir)) {
        mkdirSync(stepDir, { recursive: true });
      }
      const stepPath = join(stepDir, "step.sh");
      if (!existsSync(stepPath)) {
        writeFileSync(stepPath, stepScript);
        chmodSync(stepPath, 0o755);
      }
    }
  });

  // Restore the test server's scheduler after unit tests complete
  after(async function () {
    this.timeout(15000);
    await reconfigureTestServer(testServer, {
      maxConcurrentSteps: 10,
      flowsRoot: defaultFlowsRoot,
    });
  });

  afterEach(async () => {
    // pickAndClaimSteps fires executeStepWithRetry as fire-and-forget.
    // After the step process exits, the async chain still runs:
    //   update step status → check stage completion → trigger flow callback
    // Wait for this full chain to finish before the next test truncates tables.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  beforeEach(async () => {
    truncateAllTables(testDb);

    // Create data context - use real test flows root
    ctx = {
      db: testDb.db,
      executor: {
        config: {
          flowsRoot: defaultFlowsRoot,
          maxLogCapture: 8192,
          maxConcurrentSteps: 10,
        },
        apiUrl: "http://localhost:5099",
        processRegistry: new StepProcessRegistry(),
      },
    };

    // Create scheduler config
    config = {
      intervalMs: 200,
      batchSize: 10,
      workerId: "test-worker",
    };
  });

  it("should NOT pick up steps with queued_at=null (regression test)", async () => {
    const runId = "run-1";
    const stageId = "stage-1";
    const stepId = "step-1";
    const db = testDb.db;

    // Create run and stage
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(runId, "test-flow", "running", Date.now());

    insertStage(testDb, {
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "running",
      created_at: Date.now(),
    });

    // Insert step with queued_at=null (as retry would leave it)
    insertStep(testDb, {
      id: stepId,
      run_id: runId,
      stage_id: stageId,
      name: "test-step",
      status: "pending",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: Date.now(),
      // NOTE: queued_at is NULL - this is the regression test!
      // Before the fix, scheduler would pick this up immediately
    });

    // Verify initial state
    const beforeScheduler = db
      .prepare(`SELECT status, queued_at, claimed_at FROM step WHERE id = ?`)
      .get(stepId) as StepStatusQueryResult;

    expect(beforeScheduler.status).to.equal("pending");
    expect(beforeScheduler.queued_at).to.be.null; // Not queued yet
    expect(beforeScheduler.claimed_at).to.be.null; // Not claimed

    // Run scheduler tick
    await pickAndClaimSteps(ctx, config);

    // Verify step was NOT picked up by scheduler
    const afterScheduler = db
      .prepare(`SELECT status, queued_at, claimed_at FROM step WHERE id = ?`)
      .get(stepId) as StepStatusQueryResult;

    expect(afterScheduler.status).to.equal("pending"); // Still pending
    expect(afterScheduler.queued_at).to.be.null; // Still not queued
    expect(afterScheduler.claimed_at).to.be.null; // NOT claimed by scheduler ✓

    // This is the regression test: if the scheduler bug returns,
    // claimed_at would be set even though queued_at is null
  });

  it("should pick up steps with queued_at set", async () => {
    const runId = "run-2";
    const stageId = "stage-2";
    const stepId = "step-2";
    const db = testDb.db;

    // Create run and stage
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(runId, "test-flow", "running", Date.now());

    insertStage(testDb, {
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "running",
      created_at: Date.now(),
    });

    // Insert step with queued_at set (as orchestrator would do)
    const queuedAt = Date.now();
    insertStep(testDb, {
      id: stepId,
      run_id: runId,
      stage_id: stageId,
      name: "test-step",
      status: "pending",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: Date.now(),
    });

    // Set queued_at (simulating what orchestrator does after scheduling)
    db.prepare(`UPDATE step SET queued_at = ? WHERE id = ?`).run(
      queuedAt,
      stepId,
    );

    // Verify initial state
    const beforeScheduler = db
      .prepare(`SELECT status, queued_at, claimed_at FROM step WHERE id = ?`)
      .get(stepId) as StepStatusQueryResult;

    expect(beforeScheduler.status).to.equal("pending");
    expect(beforeScheduler.queued_at).to.equal(queuedAt); // Properly queued
    expect(beforeScheduler.claimed_at).to.be.null; // Not yet claimed

    // Run scheduler tick
    await pickAndClaimSteps(ctx, config);

    // Verify step WAS picked up by scheduler
    const afterScheduler = db
      .prepare(`SELECT status, queued_at, claimed_at FROM step WHERE id = ?`)
      .get(stepId) as StepStatusQueryResult;

    expect(afterScheduler.status).to.equal("running"); // Changed to running
    expect(afterScheduler.queued_at).to.equal(queuedAt); // Still has queue time
    expect(afterScheduler.claimed_at).to.not.be.null; // WAS claimed by scheduler ✓
  });

  it("should only pick up pending steps with queued_at set among mixed states", async () => {
    const runId = "run-3";
    const stageId = "stage-3";
    const db = testDb.db;

    // Create run and stage
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(runId, "test-flow", "running", Date.now());

    insertStage(testDb, {
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "running",
      created_at: Date.now(),
    });

    // Create various step states
    const now = Date.now();

    // Step 1: pending with queued_at=null (should NOT be picked)
    insertStep(testDb, {
      id: "step-not-queued",
      run_id: runId,
      stage_id: stageId,
      name: "not-queued",
      status: "pending",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: now,
    });

    // Step 2: pending with queued_at set (should be picked)
    insertStep(testDb, {
      id: "step-queued",
      run_id: runId,
      stage_id: stageId,
      name: "queued",
      status: "pending",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: now,
    });
    db.prepare(`UPDATE step SET queued_at = ? WHERE id = ?`).run(
      now,
      "step-queued",
    );

    // Step 3: completed (should NOT be picked)
    insertStep(testDb, {
      id: "step-completed",
      run_id: runId,
      stage_id: stageId,
      name: "completed",
      status: "completed",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: now,
    });
    db.prepare(`UPDATE step SET queued_at = ? WHERE id = ?`).run(
      now,
      "step-completed",
    );

    // Run scheduler tick
    await pickAndClaimSteps(ctx, config);

    // Verify only step-queued was picked up
    const notQueued = db
      .prepare(`SELECT status, claimed_at FROM step WHERE id = ?`)
      .get("step-not-queued") as StepClaimQueryResult;
    expect(notQueued.status).to.equal("pending");
    expect(notQueued.claimed_at).to.be.null; // NOT picked ✓

    const queued = db
      .prepare(`SELECT status, claimed_at FROM step WHERE id = ?`)
      .get("step-queued") as StepClaimQueryResult;
    expect(queued.status).to.equal("running");
    expect(queued.claimed_at).to.not.be.null; // WAS picked ✓

    const completed = db
      .prepare(`SELECT status, claimed_at FROM step WHERE id = ?`)
      .get("step-completed") as StepClaimQueryResult;
    expect(completed.status).to.equal("completed");
    // claimed_at might be null or set from before, we don't care
  });

  it("should not pick up steps from terminated runs", async () => {
    const runId = "run-4";
    const stageId = "stage-4";
    const stepId = "step-4";
    const db = testDb.db;

    // Create terminated run
    db.prepare(
      `INSERT INTO run (id, flow_name, status, created_at, termination_reason)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(runId, "test-flow", "failed", Date.now(), "aborted");

    insertStage(testDb, {
      id: stageId,
      run_id: runId,
      name: "test-stage",
      final: false,
      status: "failed",
      created_at: Date.now(),
      termination_reason: "aborted",
    });

    // Insert step with queued_at set
    const queuedAt = Date.now();
    insertStep(testDb, {
      id: stepId,
      run_id: runId,
      stage_id: stageId,
      name: "test-step",
      status: "pending",
      depends_on: [],
      retry_count: 0,
      max_retries: 0,
      created_at: Date.now(),
    });
    db.prepare(`UPDATE step SET queued_at = ? WHERE id = ?`).run(
      queuedAt,
      stepId,
    );

    // Run scheduler tick
    await pickAndClaimSteps(ctx, config);

    // Verify step was NOT picked up (because run is terminated)
    const afterScheduler = db
      .prepare(`SELECT status, claimed_at FROM step WHERE id = ?`)
      .get(stepId) as StepClaimQueryResult;

    expect(afterScheduler.status).to.equal("pending");
    expect(afterScheduler.claimed_at).to.be.null; // NOT picked up ✓
  });
});
