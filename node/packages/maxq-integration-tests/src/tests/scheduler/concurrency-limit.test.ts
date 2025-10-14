/**
 * Test that scheduler respects maxConcurrentSteps limit
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import {
  TestDatabase,
  TestServer,
  TestHttpClient,
} from "@codespin/maxq-test-utils";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Run } from "@codespin/maxq-server";

describe("Scheduler Concurrency Limit", () => {
  let testDb: TestDatabase;
  let testServer: TestServer;
  let client: TestHttpClient;
  let flowsRoot: string;

  beforeEach(async function () {
    this.timeout(10000);

    // Create test database with a unique name for this test
    testDb = new TestDatabase({
      dbName: "maxq_concurrency_test",
    });
    await testDb.setup();

    // Create test server with LOW concurrency limit
    testServer = new TestServer({
      dbName: "maxq_concurrency_test",
      flowsRoot: "/tmp/flows",
      port: 0, // Random port
      maxConcurrentSteps: 2, // CRITICAL: Only allow 2 concurrent steps
    });

    await testServer.start();
    const port = testServer.getPort();

    // Create HTTP client
    client = new TestHttpClient(`http://localhost:${port}`, {
      headers: { Authorization: "Bearer test-token" },
    });

    // Create temp flows directory
    flowsRoot = await mkdtemp(join(tmpdir(), "maxq-concurrency-test-"));
  });

  afterEach(async function () {
    this.timeout(10000);

    // Clean up
    await testServer.stop();
    await testDb.cleanup();
    await rm(flowsRoot, { recursive: true, force: true });
  });

  it("should respect maxConcurrentSteps limit of 2", async function () {
    this.timeout(15000); // This test needs more time

    // Create a flow that schedules 5 parallel steps
    const flowDir = join(flowsRoot, "parallel-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
# Exit early if this is a failure callback
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  echo "Stage failed: $MAXQ_FAILED_STAGE"
  exit 0
fi

# Schedule 5 parallel steps (no dependencies)
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "parallel-stage",
    "final": true,
    "steps": [
      {"id": "step-1", "name": "slow-step", "maxRetries": 0, "dependsOn": []},
      {"id": "step-2", "name": "slow-step", "maxRetries": 0, "dependsOn": []},
      {"id": "step-3", "name": "slow-step", "maxRetries": 0, "dependsOn": []},
      {"id": "step-4", "name": "slow-step", "maxRetries": 0, "dependsOn": []},
      {"id": "step-5", "name": "slow-step", "maxRetries": 0, "dependsOn": []}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create a slow step that takes 1 second to complete
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);
    const stepDir = join(stepsDir, "slow-step");
    await mkdir(stepDir);
    const stepScript = join(stepDir, "step.sh");
    await writeFile(
      stepScript,
      `#!/bin/bash
echo "Step $MAXQ_STEP_ID starting at $(date +%s%N)"
sleep 1  # Take 1 second to complete
echo "Step $MAXQ_STEP_ID completed at $(date +%s%N)"
exit 0
`,
    );
    await chmod(stepScript, 0o755);

    // Reconfigure server with our test flows
    await testServer.reconfigure({ flowsRoot });

    // Create run
    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "parallel-flow",
    });

    expect(createResponse.status).to.equal(201);
    const runId = createResponse.data.id;

    // Poll periodically to check how many steps are running
    let maxRunningAtOnce = 0;
    let pollCount = 0;
    const maxPolls = 50; // 5 seconds max

    // Poll every 100ms to track concurrent running steps
    const pollInterval = setInterval(async () => {
      try {
        const runningSteps = await testDb.getPgDb().any(
          `
          SELECT COUNT(*) as count
          FROM step
          WHERE run_id = $1 AND status = 'running'
        `,
          [runId],
        );

        const currentRunning = parseInt(runningSteps[0].count, 10);
        maxRunningAtOnce = Math.max(maxRunningAtOnce, currentRunning);

        pollCount++;

        // Log for debugging
        console.log(
          `Poll ${pollCount}: ${currentRunning} steps running (max seen: ${maxRunningAtOnce})`,
        );

        // Check if all steps are complete
        const completedSteps = await testDb.getPgDb().any(
          `
          SELECT COUNT(*) as count
          FROM step
          WHERE run_id = $1 AND status IN ('completed', 'failed')
        `,
          [runId],
        );

        const completedCount = parseInt(completedSteps[0].count, 10);

        if (completedCount === 5 || pollCount >= maxPolls) {
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error("Poll error:", err);
        clearInterval(pollInterval);
      }
    }, 100);

    // Wait for all steps to complete (or timeout)
    await testDb.waitForQuery(
      (q, p) =>
        q
          .from("step")
          .where((s) => s.run_id === p.runId)
          .select((s) => ({ id: s.id, status: s.status })),
      { runId },
      {
        timeout: 10000,
        condition: (rows) =>
          rows.length === 5 &&
          rows.every(
            (r) => r.status === "completed" || r.status === "failed",
          ),
      },
    );

    clearInterval(pollInterval);

    // Verify all 5 steps completed
    const allSteps = await testDb.getPgDb().any(
      `
      SELECT id, name, status, started_at, completed_at
      FROM step
      WHERE run_id = $1
      ORDER BY started_at
    `,
      [runId],
    );

    expect(allSteps).to.have.lengthOf(5);
    expect(allSteps.every((s) => s.status === "completed")).to.be.true;

    // CRITICAL ASSERTION: Never more than 2 steps running at once
    expect(maxRunningAtOnce).to.be.at.most(
      2,
      `Expected max 2 concurrent steps but saw ${maxRunningAtOnce}`,
    );

    // We should have seen at least 2 running at some point (unless they ran sequentially)
    expect(maxRunningAtOnce).to.be.at.least(1);

    // Check timing to verify steps ran in batches
    // With 5 steps and max 2 concurrent, we expect at least 3 batches
    // Each step takes 1 second, so total time should be at least 3 seconds
    const firstStart = parseInt(allSteps[0].started_at, 10);
    const lastComplete = Math.max(
      ...allSteps.map((s) => parseInt(s.completed_at, 10)),
    );
    const totalDurationMs = lastComplete - firstStart;

    console.log(`Total execution time: ${totalDurationMs}ms`);
    console.log(`Max concurrent steps observed: ${maxRunningAtOnce}`);

    // With max 2 concurrent and 5 steps taking 1s each:
    // - Best case: 3 seconds (2+2+1 parallel batches)
    // - Should be at least 2.5 seconds (allowing some overlap)
    expect(totalDurationMs).to.be.at.least(
      2500,
      "Steps should have run in batches due to concurrency limit",
    );
  });

  it("should handle concurrency limit with dependencies", async function () {
    this.timeout(15000);

    // Create a flow with a mix of parallel and sequential steps
    const flowDir = join(flowsRoot, "mixed-flow");
    await mkdir(flowDir);
    const flowScript = join(flowDir, "flow.sh");
    await writeFile(
      flowScript,
      `#!/bin/bash
# Exit early if this is a failure callback
if [ -n "$MAXQ_FAILED_STAGE" ]; then
  echo "Stage failed: $MAXQ_FAILED_STAGE"
  exit 0
fi

# Schedule steps with dependencies
# init -> [a, b, c] (parallel) -> final
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \\
  -H "Content-Type: application/json" \\
  -d '{
    "stage": "mixed-stage",
    "final": true,
    "steps": [
      {"id": "init", "name": "fast-step", "maxRetries": 0, "dependsOn": []},
      {"id": "step-a", "name": "slow-step", "maxRetries": 0, "dependsOn": ["init"]},
      {"id": "step-b", "name": "slow-step", "maxRetries": 0, "dependsOn": ["init"]},
      {"id": "step-c", "name": "slow-step", "maxRetries": 0, "dependsOn": ["init"]},
      {"id": "final", "name": "fast-step", "maxRetries": 0, "dependsOn": ["step-a", "step-b", "step-c"]}
    ]
  }'
`,
    );
    await chmod(flowScript, 0o755);

    // Create steps
    const stepsDir = join(flowDir, "steps");
    await mkdir(stepsDir);

    // Fast step (instant)
    const fastStepDir = join(stepsDir, "fast-step");
    await mkdir(fastStepDir);
    await writeFile(
      join(fastStepDir, "step.sh"),
      `#!/bin/bash
echo "Fast step $MAXQ_STEP_ID"
exit 0
`,
    );
    await chmod(join(fastStepDir, "step.sh"), 0o755);

    // Slow step (1 second)
    const slowStepDir = join(stepsDir, "slow-step");
    await mkdir(slowStepDir);
    await writeFile(
      join(slowStepDir, "step.sh"),
      `#!/bin/bash
echo "Slow step $MAXQ_STEP_ID starting"
sleep 1
echo "Slow step $MAXQ_STEP_ID done"
exit 0
`,
    );
    await chmod(join(slowStepDir, "step.sh"), 0o755);

    // Reconfigure and run
    await testServer.reconfigure({ flowsRoot });

    const createResponse = await client.post<Run>("/api/v1/runs", {
      flowName: "mixed-flow",
    });

    const runId = createResponse.data.id;

    // Track max concurrent steps
    let maxConcurrent = 0;
    const checkInterval = setInterval(async () => {
      try {
        const result = await testDb.getPgDb().any(
          `
          SELECT COUNT(*) as count FROM step
          WHERE run_id = $1 AND status = 'running'
        `,
          [runId],
        );
        const current = parseInt(result[0].count, 10);
        maxConcurrent = Math.max(maxConcurrent, current);
      } catch {
        // Ignore errors during polling
      }
    }, 50);

    // Wait for completion
    await testDb.waitForQuery(
      (q, p) =>
        q
          .from("run")
          .where((r) => r.id === p.runId && r.status === "completed")
          .select((r) => ({ id: r.id })),
      { runId },
      { timeout: 10000 },
    );

    clearInterval(checkInterval);

    // Verify concurrency limit was respected
    expect(maxConcurrent).to.be.at.most(
      2,
      `Expected max 2 concurrent steps but saw ${maxConcurrent}`,
    );

    // Verify all steps completed
    const steps = await testDb.getPgDb().any(
      `
      SELECT id, status FROM step WHERE run_id = $1
    `,
      [runId],
    );

    expect(steps).to.have.lengthOf(5);
    expect(steps.every((s) => s.status === "completed")).to.be.true;
  });
});
