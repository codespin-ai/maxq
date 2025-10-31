/**
 * Test cascade failure when steps have dependencies
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { testDb, client, testServer, defaultFlowsRoot } from "../test-setup.js";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Run } from "maxq";

describe("Cascade Failure with Dependencies", () => {
  let flowsRoot: string;

  beforeEach(async () => {
    await testDb.truncateAllTables();
    flowsRoot = await mkdtemp(join(tmpdir(), "maxq-cascade-test-"));
  });

  afterEach(async function () {
    this.timeout(10000);
    // Clean up temp directory
    await rm(flowsRoot, { recursive: true, force: true });
    // Restore original flowsRoot
    await testServer.reconfigure({ flowsRoot: defaultFlowsRoot });
  });

  it("should cascade failure to dependent steps when prerequisite fails", async () => {
    // Create flow with DAG: A fails -> B and C should be marked as failed
    const flowDir = join(flowsRoot, "cascade-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
# Exit early if this is a failure callback
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  echo "Stage failed: $MAXQ_FAILED_STAGE, not rescheduling"
  exit 0
fi

curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "cascade-stage",
    "final": true,
    "steps": [
      {"id": "step-a", "name": "step-a", "maxRetries": 0, "dependsOn": []},
      {"id": "step-b", "name": "step-b", "maxRetries": 0, "dependsOn": ["step-a"]},
      {"id": "step-c", "name": "step-c", "maxRetries": 0, "dependsOn": ["step-a"]},
      {"id": "step-d", "name": "step-d", "maxRetries": 0, "dependsOn": ["step-b", "step-c"]}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create steps
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);

    // Step A - will fail
    const stepADir = join(stepsDir, "step-a");
    await mkdir(stepADir);
    await writeFile(
      join(stepADir, "step.sh"),
      `#!/bin/bash
echo "Step A failing"
exit 1
`,
    );
    await chmod(join(stepADir, "step.sh"), 0o755);

    // Steps B, C, D - would succeed but should be skipped
    for (const stepName of ["step-b", "step-c", "step-d"]) {
      const stepDir = join(stepsDir, stepName);
      await mkdir(stepDir);
      await writeFile(
        join(stepDir, "step.sh"),
        `#!/bin/bash
echo "Step ${stepName} executing"
exit 0
`,
      );
      await chmod(join(stepDir, "step.sh"), 0o755);
    }

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "cascade-flow",
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
      { timeout: 15000 },
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
      {
        timeout: 1000,
        condition: (rows) => rows.length > 0 && rows[0]!.status === "failed",
      },
    );

    expect(stages).to.have.lengthOf(1);
    expect(stages[0]!.status).to.equal("failed");

    // Verify all steps are in terminal state
    const steps = await testDb.waitForQuery<
      { runId: string },
      { id: string; name: string; status: string; stderr: string | null }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .orderBy((s) => s.name)
          .select((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            stderr: s.stderr,
          })),
      { runId },
    );

    expect(steps).to.have.lengthOf(4);

    // Step A should have failed naturally
    const stepA = steps.find((s) => s.name === "step-a");
    expect(stepA?.status).to.equal("failed");

    // Steps B, C, D should have been marked as failed due to cascade
    const stepB = steps.find((s) => s.name === "step-b");
    expect(stepB?.status).to.equal("failed");
    expect(stepB?.stderr).to.include("dependency");

    const stepC = steps.find((s) => s.name === "step-c");
    expect(stepC?.status).to.equal("failed");
    expect(stepC?.stderr).to.include("dependency");

    const stepD = steps.find((s) => s.name === "step-d");
    expect(stepD?.status).to.equal("failed");
    expect(stepD?.stderr).to.include("dependency");
  });

  it("should handle complex DAG with partial failures", async () => {
    // Create flow with complex DAG where only some branches fail
    // A succeeds, B fails -> C depends on A (should run), D depends on B (should fail)
    const flowDir = join(flowsRoot, "partial-cascade-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
# Exit early if this is a failure callback
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  echo "Stage failed: $MAXQ_FAILED_STAGE, not rescheduling"
  exit 0
fi

curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "partial-stage",
    "final": true,
    "steps": [
      {"id": "step-a", "name": "step-a", "maxRetries": 0, "dependsOn": []},
      {"id": "step-b", "name": "step-b", "maxRetries": 0, "dependsOn": []},
      {"id": "step-c", "name": "step-c", "maxRetries": 0, "dependsOn": ["step-a"]},
      {"id": "step-d", "name": "step-d", "maxRetries": 0, "dependsOn": ["step-b"]}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create steps
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);

    // Step A - will succeed
    const stepADir = join(stepsDir, "step-a");
    await mkdir(stepADir);
    await writeFile(
      join(stepADir, "step.sh"),
      `#!/bin/bash
echo "Step A succeeding"
exit 0
`,
    );
    await chmod(join(stepADir, "step.sh"), 0o755);

    // Step B - will fail
    const stepBDir = join(stepsDir, "step-b");
    await mkdir(stepBDir);
    await writeFile(
      join(stepBDir, "step.sh"),
      `#!/bin/bash
echo "Step B failing"
exit 1
`,
    );
    await chmod(join(stepBDir, "step.sh"), 0o755);

    // Step C - should run (depends on A which succeeds)
    const stepCDir = join(stepsDir, "step-c");
    await mkdir(stepCDir);
    await writeFile(
      join(stepCDir, "step.sh"),
      `#!/bin/bash
echo "Step C executing"
exit 0
`,
    );
    await chmod(join(stepCDir, "step.sh"), 0o755);

    // Step D - should be skipped (depends on B which fails)
    const stepDDir = join(stepsDir, "step-d");
    await mkdir(stepDDir);
    await writeFile(
      join(stepDDir, "step.sh"),
      `#!/bin/bash
echo "Step D executing"
exit 0
`,
    );
    await chmod(join(stepDDir, "step.sh"), 0o755);

    // Reconfigure server
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "partial-cascade-flow",
    });

    const runId = createResponse.data.id;

    // Wait for run to fail (stage has failures)
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
      { timeout: 15000 },
    );

    expect(failedRuns).to.have.lengthOf(1);

    // Verify steps statuses
    const steps = await testDb.waitForQuery<
      { runId: string },
      { name: string; status: string }
    >(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .orderBy((s) => s.name)
          .select((s) => ({ name: s.name, status: s.status })),
      { runId },
      {
        condition: (rows) =>
          rows.length === 4 &&
          rows.every((r) => r.status === "completed" || r.status === "failed"),
      },
    );

    expect(steps).to.have.lengthOf(4);

    const stepA = steps.find((s) => s.name === "step-a");
    expect(stepA?.status).to.equal("completed"); // A succeeds

    const stepB = steps.find((s) => s.name === "step-b");
    expect(stepB?.status).to.equal("failed"); // B fails

    const stepC = steps.find((s) => s.name === "step-c");
    expect(stepC?.status).to.equal("completed"); // C runs (depends on A)

    const stepD = steps.find((s) => s.name === "step-d");
    expect(stepD?.status).to.equal("failed"); // D skipped (depends on B)
  });
});
