/**
 * Scheduler integration tests
 * Tests scheduler-driven execution model with queue, dependency resolution, and guards
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { testDb, client, testServer } from "../../test-setup.js";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Run } from "maxq";

describe("Scheduler", () => {
  let flowsRoot: string;

  beforeEach(async () => {
    await testDb.truncateAllTables();
    flowsRoot = await mkdtemp(join(tmpdir(), "maxq-scheduler-test-"));
  });

  afterEach(async function () {
    // Wait for any active flows to complete before cleaning up
    // This prevents the scheduler from trying to access deleted files
    this.timeout(10000);

    // Poll for all runs to reach terminal state (completed or failed)
    // This includes pending and running flows
    let retries = 0;
    while (retries < 50) {
      try {
        // Check for any non-terminal runs (pending or running)
        const pendingResponse = await client.get<{
          pagination: { total: number };
        }>("/api/v1/runs?status=pending&limit=1");
        const runningResponse = await client.get<{
          pagination: { total: number };
        }>("/api/v1/runs?status=running&limit=1");

        const pendingCount = pendingResponse.data?.pagination?.total || 0;
        const runningCount = runningResponse.data?.pagination?.total || 0;

        if (pendingCount === 0 && runningCount === 0) {
          break; // All runs are in terminal state
        }
      } catch {
        // Ignore errors, server might be shutting down
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries++;
    }

    // Now safe to clean up
    await rm(flowsRoot, { recursive: true, force: true });
  });

  it("should execute steps in correct dependency order via scheduler", async () => {
    // Test scheduler-driven execution with dependencies
    // Verifies that scheduler waits for dependencies before claiming steps
    const flowDir = join(flowsRoot, "dependency-order-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "dag-stage",
    "final": true,
    "steps": [
      {"id": "init", "name": "init", "maxRetries": 0, "dependsOn": []},
      {"id": "task-a", "name": "task-a", "dependsOn": ["init"], "maxRetries": 0},
      {"id": "task-b", "name": "task-b", "dependsOn": ["init"], "maxRetries": 0},
      {"id": "aggregate", "name": "aggregate", "dependsOn": ["task-a", "task-b"], "maxRetries": 0}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create steps that write to order log
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);

    const orderLogPath = join(flowsRoot, "execution-order.log");
    await writeFile(orderLogPath, "");
    await chmod(orderLogPath, 0o666);

    for (const stepName of ["init", "task-a", "task-b", "aggregate"]) {
      const stepDir = join(stepsDir, stepName);
      await mkdir(stepDir);
      const stepScript = join(stepDir, "step.sh");
      await writeFile(
        stepScript,
        `#!/bin/bash
echo "${stepName}" >> "${orderLogPath}"
sleep 0.1
`,
      );
      await chmod(stepScript, 0o755);
    }

    await testServer.reconfigure({ flowsRoot });

    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "dependency-order-flow",
    });

    const runId = createResponse.data.id;

    // Wait for all 4 steps to complete
    await testDb.waitForQuery<
      { runId: string },
      { name: string; status: string; started_at: number | null }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({
            name: s.name,
            status: s.status,
            started_at: s.started_at,
          })),
      { runId },
      {
        timeout: 5000,
        condition: (rows) =>
          rows.length === 4 && rows.every((r) => r.status === "completed"),
      },
    );

    // Verify steps were claimed and executed in correct dependency order
    const steps = await testDb.waitForQuery<
      { runId: string },
      {
        name: string;
        status: string;
        queued_at: number | null;
        claimed_at: number | null;
        started_at: number | null;
        completed_at: number | null;
      }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .orderBy((s) => s.started_at)
          .select((s) => ({
            name: s.name,
            status: s.status,
            queued_at: s.queued_at,
            claimed_at: s.claimed_at,
            started_at: s.started_at,
            completed_at: s.completed_at,
          })),
      { runId },
    );

    expect(steps).to.have.lengthOf(4);

    // All steps should have queue/timing fields populated
    for (const step of steps) {
      expect(step.queued_at).to.be.a("number");
      expect(step.claimed_at).to.be.a("number");
      expect(step.started_at).to.be.a("number");
      expect(step.completed_at).to.be.a("number");
    }

    // Verify dependency order: init first, then task-a/task-b (parallel), then aggregate
    expect(steps[0]!.name).to.equal("init");

    // task-a and task-b can run in either order (parallel)
    const parallelSteps = [steps[1]!.name, steps[2]!.name].sort();
    expect(parallelSteps).to.deep.equal(["task-a", "task-b"]);

    // aggregate must be last
    expect(steps[3]!.name).to.equal("aggregate");

    // Verify aggregate started after both dependencies completed
    const taskACompletedAt = steps.find(
      (s) => s.name === "task-a",
    )!.completed_at!;
    const taskBCompletedAt = steps.find(
      (s) => s.name === "task-b",
    )!.completed_at!;
    const aggregateStartedAt = steps.find(
      (s) => s.name === "aggregate",
    )!.started_at!;

    expect(aggregateStartedAt).to.be.greaterThan(taskACompletedAt);
    expect(aggregateStartedAt).to.be.greaterThan(taskBCompletedAt);

    // Verify run completed
    await testDb.waitForQuery<
      { runId: string; status: string },
      { id: string }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId && r.status === p.status)
          .select((r) => ({ id: r.id })),
      { runId, status: "completed" },
    );
  });

  it("should reject scheduling for terminated runs but allow naturally failed runs", async () => {
    // Test that scheduler guards work correctly:
    // Part 1: Aborted runs (terminationReason='aborted') cannot schedule new stages
    // Part 2 (TODO): Naturally failed runs (terminationReason=null) CAN schedule compensating stages
    //                This part is commented out due to complexity - will be added in future

    // Create simple flow for testing abort guard
    const flowDir = join(flowsRoot, "guard-test-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "test-stage",
    "final": true,
    "steps": [
      {"id": "test-step", "name": "test-step", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create step
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "test-step");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "Step running"
sleep 1
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    await testServer.reconfigure({ flowsRoot });

    // Create run and abort it
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "guard-test-flow",
    });

    const runId = createResponse.data.id;

    // Wait for stage to be created
    await testDb.waitForQuery<{ runId: string }, { id: string }>(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id })),
      { runId },
      { timeout: 3000 },
    );

    // Abort the run
    await client.post(`/api/v1/runs/${runId}/abort`, {});

    // Wait for abort to complete
    await testDb.waitForQuery<
      { runId: string },
      { status: string; termination_reason: string | null }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId)
          .select((r) => ({
            status: r.status,
            termination_reason: r.termination_reason,
          })),
      { runId },
      {
        timeout: 3000,
        condition: (rows) =>
          rows.length > 0 &&
          rows[0]!.status === "failed" &&
          rows[0]!.termination_reason === "aborted",
      },
    );

    // Try to schedule a stage manually (simulating what flow would do)
    const scheduleResponse = await client.post(`/api/v1/runs/${runId}/steps`, {
      stage: "blocked-stage",
      final: true,
      steps: [
        {
          id: "blocked-step",
          name: "blocked-step",
          dependsOn: [],
          maxRetries: 0,
        },
      ],
    });

    // Should be rejected with 400
    expect(scheduleResponse.status).to.equal(400);
    expect(scheduleResponse.data).to.have.property("error");
    expect((scheduleResponse.data as { error: string }).error).to.include(
      "terminated",
    );
  });

  it("should kill flow processes during abort", async () => {
    // Test that flow processes are registered and killed during abort
    // This verifies the flow process registration fix
    const flowDir = join(flowsRoot, "flow-abort-test");
    await mkdir(flowDir);

    // Create flow that sleeps before scheduling stage
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
echo "Flow starting"

# Sleep for 5 seconds before scheduling
# This gives us time to abort and verify the flow process is killed
sleep 5

curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "never-scheduled",
    "final": true,
    "steps": [
      {"id": "never-executed", "name": "never-executed", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create step (won't be executed)
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "never-executed");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "This should never run"
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "flow-abort-test",
    });

    const runId = createResponse.data.id;

    // Wait a moment for flow to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Abort while flow is sleeping
    const abortResponse = await client.post(`/api/v1/runs/${runId}/abort`, {});
    expect(abortResponse.status).to.equal(200);

    // Verify processes were killed (should be at least 1 for flow)
    expect(
      (abortResponse.data as { processesKilled: number }).processesKilled,
    ).to.be.greaterThan(0);

    // Wait for abort to complete
    await testDb.waitForQuery<
      { runId: string },
      { status: string; termination_reason: string | null }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId)
          .select((r) => ({
            status: r.status,
            termination_reason: r.termination_reason,
          })),
      { runId },
      {
        timeout: 3000,
        condition: (rows) =>
          rows.length > 0 &&
          rows[0]!.status === "failed" &&
          rows[0]!.termination_reason === "aborted",
      },
    );

    // Verify stage was NEVER created (flow was killed before scheduling)
    const stages = await testDb.waitForQuery<{ runId: string }, { id: string }>(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id })),
      { runId },
      { timeout: 500, condition: () => true },
    );

    expect(stages).to.have.lengthOf(0); // No stages created

    // Verify no steps were created
    const steps = await testDb.waitForQuery<{ runId: string }, { id: string }>(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id })),
      { runId },
      { timeout: 500, condition: () => true },
    );

    expect(steps).to.have.lengthOf(0); // No steps created
  });

  it("should clear queue fields on abort and retry", async function () {
    this.timeout(30000); // This test involves aborting and retrying a 10s step
    // Test that abort clears queue/timing fields and retry resets them
    const flowDir = join(flowsRoot, "queue-fields-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "test-stage",
    "final": true,
    "steps": [
      {"id": "test-step", "name": "test-step", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create step that sleeps
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "test-step");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "Step running"
sleep 10
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "queue-fields-flow",
    });

    const runId = createResponse.data.id;

    // Wait for step to be running (not just queued and claimed)
    await testDb.waitForQuery<
      { runId: string; status: string },
      { queued_at: number | null; claimed_at: number | null; status: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId && s.status === p.status)
          .select((s) => ({
            queued_at: s.queued_at,
            claimed_at: s.claimed_at,
            status: s.status,
          })),
      { runId, status: "running" },
      {
        timeout: 3000,
        condition: (rows) =>
          rows.length > 0 &&
          rows[0]!.status === "running" &&
          rows[0]!.queued_at !== null &&
          rows[0]!.claimed_at !== null,
      },
    );

    // Give the step a moment to actually start executing
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Abort the run
    await client.post(`/api/v1/runs/${runId}/abort`, {});

    // Wait for abort to complete
    await testDb.waitForQuery<
      { runId: string },
      { status: string; termination_reason: string | null }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId)
          .select((r) => ({
            status: r.status,
            termination_reason: r.termination_reason,
          })),
      { runId },
      {
        timeout: 3000,
        condition: (rows) =>
          rows.length > 0 &&
          rows[0]!.status === "failed" &&
          rows[0]!.termination_reason === "aborted",
      },
    );

    // Verify queue fields were cleared on abort
    const abortedSteps = await testDb.waitForQuery<
      { runId: string },
      {
        status: string;
        queued_at: number | null;
        claimed_at: number | null;
        heartbeat_at: number | null;
        worker_id: string | null;
      }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({
            status: s.status,
            queued_at: s.queued_at,
            claimed_at: s.claimed_at,
            heartbeat_at: s.heartbeat_at,
            worker_id: s.worker_id,
          })),
      { runId },
    );

    expect(abortedSteps).to.have.lengthOf(1);
    expect(abortedSteps[0]!.status).to.equal("failed");
    expect(abortedSteps[0]!.queued_at).to.equal(null); // Cleared
    expect(abortedSteps[0]!.claimed_at).to.equal(null); // Cleared
    expect(abortedSteps[0]!.heartbeat_at).to.equal(null); // Cleared
    expect(abortedSteps[0]!.worker_id).to.equal(null); // Cleared

    // Retry the run
    await client.post(`/api/v1/runs/${runId}/retry`, {});

    // Wait for run to complete after retry
    // NOTE: We don't check the transient "pending with cleared fields" state here
    // because it exists for microseconds and can't be reliably observed.
    // Instead, we have unit tests (retry-run.test.ts) that verify the retry logic
    // properly clears queue fields. This integration test verifies end-to-end behavior.
    await testDb.waitForQuery<
      { runId: string; status: string },
      { status: string }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId && r.status === p.status)
          .select((r) => ({ status: r.status })),
      { runId, status: "completed" },
      { timeout: 15000 },
    );

    // Verify queue fields were populated again during execution
    const completedSteps = await testDb.waitForQuery<
      { runId: string },
      {
        status: string;
        queued_at: number | null;
        claimed_at: number | null;
      }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({
            status: s.status,
            queued_at: s.queued_at,
            claimed_at: s.claimed_at,
          })),
      { runId },
    );

    expect(completedSteps).to.have.lengthOf(1);
    expect(completedSteps[0]!.status).to.equal("completed");
    expect(completedSteps[0]!.queued_at).to.be.a("number"); // Populated again
    expect(completedSteps[0]!.claimed_at).to.be.a("number"); // Populated again
  });
});
