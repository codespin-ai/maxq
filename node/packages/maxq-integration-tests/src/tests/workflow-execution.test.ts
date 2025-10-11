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
cat <<'EOF'
{
  "stage": "execution",
  "final": true,
  "steps": [
    {"name": "hello-step", "instances": 1}
  ]
}
EOF
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
    const createResponse = await client.post("/api/v1/runs", {
      flowName: "simple-flow",
      input: { test: "data" },
    });

    expect(createResponse.status).to.equal(201);
    const runId = createResponse.data.id;

    // Wait for run to complete (status changes from 'pending' to 'completed')
    const completedRuns = await testDb.waitForSql<{
      id: string;
      status: string;
    }>(
      "SELECT id, status FROM run WHERE id = ? AND status = ?",
      [runId, "completed"],
      { timeout: 3000 },
    );

    expect(completedRuns).to.have.lengthOf(1);
    expect(completedRuns[0].status).to.equal("completed");

    // Verify run details
    const runResponse = await client.get(`/api/v1/runs/${runId}`);
    expect(runResponse.data.status).to.equal("completed");
    expect(runResponse.data.flowName).to.equal("simple-flow");

    // Verify stage was created
    const stages = await testDb.waitForSql<{
      name: string;
      status: string;
      final: boolean;
    }>("SELECT name, status, final FROM stage WHERE run_id = ?", [runId]);

    expect(stages).to.have.lengthOf(1);
    expect(stages[0].name).to.equal("execution");
    expect(stages[0].status).to.equal("completed");
    expect(stages[0].final).to.equal(true);

    // Verify step was created with stdout/stderr
    const steps = await testDb.waitForSql<{
      name: string;
      status: string;
      stdout: string;
      stderr: string;
      sequence: number;
    }>(
      "SELECT name, status, stdout, stderr, sequence FROM step WHERE run_id = ?",
      [runId],
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0].name).to.equal("hello-step");
    expect(steps[0].status).to.equal("completed");
    expect(steps[0].sequence).to.equal(0);
    expect(steps[0].stdout).to.include("Hello from step");
    expect(steps[0].stderr).to.include("Step error");
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
  # First call - return stage 1
  cat <<'EOF'
{
  "stage": "stage-1",
  "final": false,
  "steps": [
    {"name": "step-1", "instances": 1}
  ]
}
EOF
elif [ "$MAXQ_COMPLETED_STAGE" = "stage-1" ]; then
  # After stage 1 completes - return final stage
  cat <<'EOF'
{
  "stage": "stage-2",
  "final": true,
  "steps": [
    {"name": "step-2", "instances": 1}
  ]
}
EOF
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
    const createResponse = await client.post("/api/v1/runs", {
      flowName: "multi-stage-flow",
    });

    const runId = createResponse.data.id;

    // Wait for run to complete
    await testDb.waitForSql(
      "SELECT id FROM run WHERE id = ? AND status = ?",
      [runId, "completed"],
      { timeout: 3000 },
    );

    // Verify both stages were created
    const stages = await testDb.waitForSql<{
      name: string;
      status: string;
      final: boolean;
    }>(
      "SELECT name, status, final FROM stage WHERE run_id = ? ORDER BY created_at",
      [runId],
      { condition: (rows) => rows.length === 2 },
    );

    expect(stages).to.have.lengthOf(2);
    expect(stages[0].name).to.equal("stage-1");
    expect(stages[0].final).to.equal(false);
    expect(stages[1].name).to.equal("stage-2");
    expect(stages[1].final).to.equal(true);

    // Verify both steps were created
    const steps = await testDb.waitForSql<{ name: string }>(
      "SELECT name FROM step WHERE run_id = ? ORDER BY created_at",
      [runId],
      { condition: (rows) => rows.length === 2 },
    );

    expect(steps).to.have.lengthOf(2);
    expect(steps[0].name).to.equal("step-1");
    expect(steps[1].name).to.equal("step-2");
  });

  it("should handle workflow with DAG dependencies", async () => {
    // Create flow with parallel steps
    const flowDir = join(flowsRoot, "dag-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
cat <<'EOF'
{
  "stage": "parallel-stage",
  "final": true,
  "steps": [
    {"name": "init", "instances": 1},
    {"name": "task-a", "dependsOn": ["init"], "instances": 1},
    {"name": "task-b", "dependsOn": ["init"], "instances": 1},
    {"name": "aggregate", "dependsOn": ["task-a", "task-b"], "instances": 1}
  ]
}
EOF
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
    const createResponse = await client.post("/api/v1/runs", {
      flowName: "dag-flow",
    });

    const runId = createResponse.data.id;

    // Wait for all 4 steps to complete
    const steps = await testDb.waitForSql<{ name: string; status: string }>(
      "SELECT name, status FROM step WHERE run_id = ?",
      [runId],
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
    await testDb.waitForSql("SELECT id FROM run WHERE id = ? AND status = ?", [
      runId,
      "completed",
    ]);
  });

  it("should handle workflow failure and mark run as failed", async () => {
    // Create flow with failing step
    const flowDir = join(flowsRoot, "failing-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
cat <<'EOF'
{
  "stage": "fail-stage",
  "final": true,
  "steps": [
    {"name": "fail-step", "instances": 1}
  ]
}
EOF
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
    const createResponse = await client.post("/api/v1/runs", {
      flowName: "failing-flow",
    });

    const runId = createResponse.data.id;

    // Wait for run to fail
    const failedRuns = await testDb.waitForSql<{ status: string }>(
      "SELECT status FROM run WHERE id = ? AND status = ?",
      [runId, "failed"],
      { timeout: 3000 },
    );

    expect(failedRuns).to.have.lengthOf(1);
    expect(failedRuns[0].status).to.equal("failed");

    // Verify stage was marked as failed
    const stages = await testDb.waitForSql<{ status: string }>(
      "SELECT status FROM stage WHERE run_id = ?",
      [runId],
    );

    expect(stages).to.have.lengthOf(1);
    expect(stages[0].status).to.equal("failed");

    // Verify step was marked as failed with stdout
    const steps = await testDb.waitForSql<{ status: string; stdout: string }>(
      "SELECT status, stdout FROM step WHERE run_id = ?",
      [runId],
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0].status).to.equal("failed");
    expect(steps[0].stdout).to.include("About to fail");
  });

  it("should handle step retry logic", async () => {
    // Create flow with retrying step
    const flowDir = join(flowsRoot, "retry-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
cat <<'EOF'
{
  "stage": "retry-stage",
  "final": true,
  "steps": [
    {"name": "retry-step", "instances": 1, "maxRetries": 2}
  ]
}
EOF
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
    const createResponse = await client.post("/api/v1/runs", {
      flowName: "retry-flow",
    });

    const runId = createResponse.data.id;

    // Wait for step to complete after retries
    const steps = await testDb.waitForSql<{
      status: string;
      retry_count: number;
      stdout: string;
    }>(
      "SELECT status, retry_count, stdout FROM step WHERE run_id = ?",
      [runId],
      { timeout: 3000 },
    );

    expect(steps).to.have.lengthOf(1);
    expect(steps[0].status).to.equal("completed");
    expect(steps[0].retry_count).to.equal(2); // Failed 2 times, succeeded on 3rd
    expect(steps[0].stdout).to.include("Success on attempt 3");

    // Verify run completed
    await testDb.waitForSql("SELECT id FROM run WHERE id = ? AND status = ?", [
      runId,
      "completed",
    ]);
  });
});
