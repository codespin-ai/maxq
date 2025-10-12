/**
 * End-to-end workflow execution tests
 * Tests actual workflow execution through HTTP API with async orchestrator
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { testDb, client, testServer } from "../test-setup.js";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Run } from "@codespin/maxq-server";

describe("Workflow Execution E2E", () => {
  let flowsRoot: string;

  beforeEach(async () => {
    await testDb.truncateAllTables();
    flowsRoot = await mkdtemp(join(tmpdir(), "maxq-workflow-test-"));
  });

  afterEach(async () => {
    await rm(flowsRoot, { recursive: true, force: true });
  });

  it("should execute a simple workflow with one stage and capture stdout", async () => {
    // Create a simple flow with one stage
    const flowDir = join(flowsRoot, "simple-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
echo "Flow started" >&2

# Schedule stage via HTTP API (as per spec)
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "execution",
    "final": true,
    "steps": [
      {"id": "hello-step", "name": "hello-step", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create the step
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "hello-step");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "Hello from step"
echo "Step error" >&2
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    // Reconfigure server to use our temp flows directory
    await testServer.reconfigure({ flowsRoot });

    // Create run via API
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "simple-flow",
      input: { test: "data" },
    });

    expect(createResponse.status).to.equal(201);
    const runId = createResponse.data.id;

    // Wait for run to complete (status changes from 'pending' to 'completed')
    const completedRuns = await testDb.waitForQuery<
      { runId: string; status: string },
      { id: string; status: string }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId && r.status === p.status)
          .select((r) => ({ id: r.id, status: r.status })),
      { runId, status: "completed" },
      { timeout: 3000 },
    );

    expect(completedRuns).to.have.lengthOf(1);
    expect(completedRuns[0]!.status).to.equal("completed");

    // Verify run details
    const runResponse = await client.get<Run>(`/api/v1/runs/${runId}`);
    expect(runResponse.data.status).to.equal("completed");
    expect(runResponse.data.flowName).to.equal("simple-flow");

    // Verify stage was created
    const stages = await testDb.waitForQuery<
      { runId: string },
      { name: string; status: string; final: boolean }
    >(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ name: s.name, status: s.status, final: s.final })),
      { runId },
    );

    expect(stages).to.have.lengthOf(1);
    expect(stages[0]!.name).to.equal("execution");
    expect(stages[0]!.status).to.equal("completed");
    expect(stages[0]!.final).to.equal(true);

    // Verify step was created with stdout/stderr
    const steps = await testDb.waitForQuery<
      { runId: string },
      {
        name: string;
        status: string;
        stdout: string;
        stderr: string;
      }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({
            name: s.name,
            status: s.status,
            stdout: s.stdout,
            stderr: s.stderr,
          })),
      { runId },
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0]!.name).to.equal("hello-step");
    expect(steps[0]!.status).to.equal("completed");
    expect(steps[0]!.stdout).to.include("Hello from step");
    expect(steps[0]!.stderr).to.include("Step error");
  });

  it("should execute multi-stage workflow with callbacks", async () => {
    // Create a flow with multiple stages
    const flowDir = join(flowsRoot, "multi-stage-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash

if [ -z "$MAXQ_COMPLETED_STAGE" ]; then
  # First call - schedule stage 1
  curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
    -H "Content-Type: application/json" \\
    -d '{
      "stage": "stage-1",
      "final": false,
      "steps": [
        {"id": "step-1", "name": "step-1", "maxRetries": 0, "dependsOn": []}
      ]
    }'
elif [ "$MAXQ_COMPLETED_STAGE" = "stage-1" ]; then
  # After stage 1 completes - schedule final stage
  curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
    -H "Content-Type: application/json" \\
    -d '{
      "stage": "stage-2",
      "final": true,
      "steps": [
        {"id": "step-2", "name": "step-2", "maxRetries": 0, "dependsOn": []}
      ]
    }'
fi
`,
    );
    await chmod(flowScript, 0o755);

    // Create steps
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);

    for (const stepName of ["step-1", "step-2"]) {
      const stepDir = join(stepsDir, stepName);
      await mkdir(stepDir);
      const stepScript = join(stepDir, "step.sh");
      await writeFile(
        stepScript,
        `#!/bin/bash
echo "Executed ${stepName}"
`,
      );
      await chmod(stepScript, 0o755);
    }

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "multi-stage-flow",
    });

    const runId = createResponse.data.id;

    // Wait for run to complete
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
      { timeout: 3000 },
    );

    // Verify both stages were created
    const stages = await testDb.waitForQuery<
      { runId: string },
      { name: string; status: string; final: boolean }
    >(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .orderBy((s) => s.created_at)
          .select((s) => ({ name: s.name, status: s.status, final: s.final })),
      { runId },
      { condition: (rows) => rows.length === 2 },
    );

    expect(stages).to.have.lengthOf(2);
    expect(stages[0]!.name).to.equal("stage-1");
    expect(stages[0]!.final).to.equal(false);
    expect(stages[1]!.name).to.equal("stage-2");
    expect(stages[1]!.final).to.equal(true);

    // Verify both steps were created
    const steps = await testDb.waitForQuery<
      { runId: string },
      { name: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .orderBy((s) => s.created_at)
          .select((s) => ({ name: s.name })),
      { runId },
      { condition: (rows) => rows.length === 2 },
    );

    expect(steps).to.have.lengthOf(2);
    expect(steps[0]!.name).to.equal("step-1");
    expect(steps[1]!.name).to.equal("step-2");
  });

  it("should handle workflow with DAG dependencies", async () => {
    // Create flow with parallel steps
    const flowDir = join(flowsRoot, "dag-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "parallel-stage",
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

    // Create steps
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);

    for (const stepName of ["init", "task-a", "task-b", "aggregate"]) {
      const stepDir = join(stepsDir, stepName);
      await mkdir(stepDir);
      const stepScript = join(stepDir, "step.sh");
      await writeFile(
        stepScript,
        `#!/bin/bash
echo "Executed ${stepName}"
`,
      );
      await chmod(stepScript, 0o755);
    }

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "dag-flow",
    });

    const runId = createResponse.data.id;

    // Wait for all 4 steps to complete
    const steps = await testDb.waitForQuery<
      { runId: string },
      { name: string; status: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ name: s.name, status: s.status })),
      { runId },
      {
        timeout: 3000,
        condition: (rows) =>
          rows.length === 4 && rows.every((r) => r.status === "completed"),
      },
    );

    expect(steps).to.have.lengthOf(4);

    const stepNames = steps.map((s) => s.name).sort();
    expect(stepNames).to.deep.equal(["aggregate", "init", "task-a", "task-b"]);

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

  it("should handle workflow failure and mark run as failed", async () => {
    // Create flow with failing step
    const flowDir = join(flowsRoot, "failing-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "fail-stage",
    "final": true,
    "steps": [
      {"id": "fail-step", "name": "fail-step", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create failing step
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "fail-step");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "About to fail"
exit 1
`,
    );
    await chmod(stepScript, 0o755);

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "failing-flow",
    });

    const runId = createResponse.data.id;

    // Wait for run to fail
    const failedRuns = await testDb.waitForQuery<
      { runId: string; status: string },
      { status: string }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId && r.status === p.status)
          .select((r) => ({ status: r.status })),
      { runId, status: "failed" },
      { timeout: 3000 },
    );

    expect(failedRuns).to.have.lengthOf(1);
    expect(failedRuns[0]!.status).to.equal("failed");

    // Verify stage was marked as failed
    const stages = await testDb.waitForQuery<
      { runId: string },
      { status: string }
    >(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ status: s.status })),
      { runId },
    );

    expect(stages).to.have.lengthOf(1);
    expect(stages[0]!.status).to.equal("failed");

    // Verify step was marked as failed with stdout
    const steps = await testDb.waitForQuery<
      { runId: string },
      { status: string; stdout: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ status: s.status, stdout: s.stdout })),
      { runId },
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0]!.status).to.equal("failed");
    expect(steps[0]!.stdout).to.include("About to fail");
  });

  it("should handle step retry logic", async () => {
    // Create flow with retrying step
    const flowDir = join(flowsRoot, "retry-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "retry-stage",
    "final": true,
    "steps": [
      {"id": "retry-step", "name": "retry-step", "maxRetries": 2, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create step that fails first 2 times, succeeds on 3rd
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "retry-step");
    await mkdir(stepDir);
    const counterFile = join(stepDir, "counter.txt");
    await writeFile(counterFile, "0");
    await chmod(counterFile, 0o666);

    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
COUNTER_FILE="${counterFile}"
COUNTER=$(cat "$COUNTER_FILE")
COUNTER=$((COUNTER + 1))
echo "$COUNTER" > "$COUNTER_FILE"

echo "Attempt $COUNTER"

if [ "$COUNTER" -lt "3" ]; then
  exit 1
fi

echo "Success on attempt $COUNTER"
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "retry-flow",
    });

    const runId = createResponse.data.id;

    // Wait for step to complete after retries
    const steps = await testDb.waitForQuery<
      { runId: string },
      { status: string; retry_count: number; stdout: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({
            status: s.status,
            retry_count: s.retry_count,
            stdout: s.stdout,
          })),
      { runId },
      { timeout: 3000 },
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0]!.status).to.equal("completed");
    expect(steps[0]!.retry_count).to.equal(2); // Failed 2 times, succeeded on 3rd
    expect(steps[0]!.stdout).to.include("Success on attempt 3");

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

  it("should honor fields.status over exit code (exit 0 with status failed)", async () => {
    // Create flow
    const flowDir = join(flowsRoot, "status-override-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "override-stage",
    "final": true,
    "steps": [
      {"id": "override-step", "name": "override-step", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create step that sleep briefly to allow us to post fields first
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "override-step");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "Step executing"
# Sleep to allow test to post fields
sleep 0.5
echo "Exiting with code 0"
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "status-override-flow",
    });

    const runId = createResponse.data.id;

    // Wait for step to be created
    const createdSteps = await testDb.waitForQuery<
      { runId: string },
      { id: string; name: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id, name: s.name })),
      { runId },
      { timeout: 3000 },
    );

    expect(createdSteps).to.have.lengthOf(1);
    const stepId = createdSteps[0]!.id;

    // Post status="failed" via /fields endpoint (per spec §5.5)
    // This should override the exit code 0
    const fieldsResponse = await client.post(
      `/api/v1/runs/${runId}/steps/${stepId}/fields`,
      {
        fields: {
          status: "failed",
          reason: "validation failed",
        },
      },
    );
    expect(fieldsResponse.status).to.equal(200);

    // Wait for step to complete (with any status)
    await testDb.waitForQuery<{ runId: string }, { status: string }>(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ status: s.status })),
      { runId },
      {
        timeout: 5000,
        condition: (rows) => rows.length > 0 && rows[0]!.status !== "pending",
      },
    );

    // Now check run status - should be failed (wait for terminal state)
    const runs = await testDb.waitForQuery<
      { runId: string },
      { status: string }
    >(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId)
          .select((r) => ({ status: r.status })),
      { runId },
      {
        timeout: 5000,
        condition: (rows) =>
          rows.length > 0 &&
          rows[0]!.status !== "pending" &&
          rows[0]!.status !== "running",
      },
    );

    expect(runs).to.have.lengthOf(1);
    expect(runs[0]!.status).to.equal("failed");

    // Verify stage was marked as failed
    const stages = await testDb.waitForQuery<
      { runId: string },
      { status: string }
    >(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ status: s.status })),
      { runId },
    );

    expect(stages).to.have.lengthOf(1);
    expect(stages[0]!.status).to.equal("failed");

    // Verify step was marked as failed (fields.status took precedence)
    const steps = await testDb.waitForQuery<
      { runId: string },
      { status: string; fields: unknown }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ status: s.status, fields: s.fields })),
      { runId },
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0]!.status).to.equal("failed");
    // fields is JSONB, pg-promise parses it automatically to object
    const fields = steps[0]!.fields as Record<string, unknown>;
    expect(fields.status).to.equal("failed");
    expect(fields.reason).to.equal("validation failed");
  });

  it("should return 404 for scheduling stage with non-existent run", async () => {
    // Create flow
    const flowDir = join(flowsRoot, "test-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(flowScript, `#!/bin/bash\necho "Flow"\n`);
    await chmod(flowScript, 0o755);

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Try to schedule stage for non-existent run
    const fakeRunId = "00000000-0000-0000-0000-000000000000";

    const response = await client.post(`/api/v1/runs/${fakeRunId}/steps`, {
      stage: "dummy",
      final: true,
      steps: [
        {
          id: "dummy-step",
          name: "dummy-step",
          dependsOn: [],
          maxRetries: 0,
        },
      ],
    });

    // Should return 404, not 500
    expect(response.status).to.equal(404);
    expect(response.data).to.deep.equal({ error: "Run not found" });

    // Verify no stage or step records were created (transaction rolled back)
    // Use waitForQuery with immediate condition check
    const stages = await testDb.waitForQuery<{ runId: string }, { id: string }>(
      (q, p) =>
        q
          .from("stage")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id })),
      { runId: fakeRunId },
      { timeout: 500, condition: () => true }, // Check immediately
    );
    expect(stages).to.have.lengthOf(0);

    const steps = await testDb.waitForQuery<{ runId: string }, { id: string }>(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id })),
      { runId: fakeRunId },
      { timeout: 500, condition: () => true }, // Check immediately
    );
    expect(steps).to.have.lengthOf(0);
  });
});
