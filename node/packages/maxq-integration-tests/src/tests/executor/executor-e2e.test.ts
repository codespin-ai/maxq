/**
 * End-to-end integration tests for workflow executors
 * Tests flow executor, step executor, DAG execution, retry logic, and parallel execution
 */

import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import {
  executeFlowInitial,
  executeFlowStageCompleted,
  executeFlowStageFailed,
} from "@codespin/maxq-server/dist/executor/flow-executor.js";
import {
  executeStep,
  executeStepsDAG,
  type StepDefinition,
} from "@codespin/maxq-server/dist/executor/step-executor.js";
import { StepProcessRegistry } from "@codespin/maxq-server/dist/executor/process-registry.js";
import { mkdtemp, writeFile, chmod, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("Executor End-to-End Tests", () => {
  let flowsRoot: string;
  let processRegistry: StepProcessRegistry;

  beforeEach(async () => {
    flowsRoot = await mkdtemp(join(tmpdir(), "maxq-e2e-test-"));
    processRegistry = new StepProcessRegistry();
  });

  afterEach(async () => {
    await rm(flowsRoot, { recursive: true, force: true });
  });

  describe("Flow Executor", () => {
    it("should execute flow and capture stdout/stderr (no JSON parsing)", async () => {
      // Flows communicate via HTTP API, not stdout JSON
      // stdout/stderr are captured for debugging only
      const flowDir = join(flowsRoot, "test-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(
        flowScript,
        `#!/bin/bash
echo "Flow executing - would call HTTP API here" >&2
# In real flow: curl -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" ...
exit 0
`,
      );
      await chmod(flowScript, 0o755);

      const result = await executeFlowInitial({
        runId: "test-run-123",
        flowName: "test-flow",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
      });

      expect(result.processResult.exitCode).to.equal(0);
      expect(result.response).to.be.null; // Flows don't return JSON responses
      expect(result.processResult.stderr).to.include(
        "Flow executing - would call HTTP API here",
      );
    });

    it("should pass environment variables to flow", async () => {
      const flowDir = join(flowsRoot, "env-test-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(
        flowScript,
        `#!/bin/bash
echo "RUN_ID=$MAXQ_RUN_ID"
echo "FLOW_NAME=$MAXQ_FLOW_NAME"
echo "API=$MAXQ_API"
exit 0
`,
      );
      await chmod(flowScript, 0o755);

      const result = await executeFlowInitial({
        runId: "run-456",
        flowName: "env-test-flow",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
      });

      expect(result.processResult.exitCode).to.equal(0);
      expect(result.processResult.stdout).to.include("RUN_ID=run-456");
      expect(result.processResult.stdout).to.include("FLOW_NAME=env-test-flow");
      expect(result.processResult.stdout).to.include(
        "API=http://localhost:5003/api/v1",
      );
    });

    it("should handle flow with completed stage callback", async () => {
      const flowDir = join(flowsRoot, "callback-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(
        flowScript,
        `#!/bin/bash
echo "COMPLETED_STAGE=$MAXQ_COMPLETED_STAGE"
exit 0
`,
      );
      await chmod(flowScript, 0o755);

      const result = await executeFlowStageCompleted({
        runId: "run-789",
        flowName: "callback-flow",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
        completedStage: "previous-stage",
      });

      expect(result.processResult.exitCode).to.equal(0);
      expect(result.processResult.stdout).to.include(
        "COMPLETED_STAGE=previous-stage",
      );
    });

    it("should handle flow with failed stage callback", async () => {
      const flowDir = join(flowsRoot, "failure-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(
        flowScript,
        `#!/bin/bash
echo "FAILED_STAGE=$MAXQ_FAILED_STAGE"
exit 0
`,
      );
      await chmod(flowScript, 0o755);

      const result = await executeFlowStageFailed({
        runId: "run-abc",
        flowName: "failure-flow",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
        failedStage: "failed-stage",
      });

      expect(result.processResult.exitCode).to.equal(0);
      expect(result.processResult.stdout).to.include(
        "FAILED_STAGE=failed-stage",
      );
    });

    it("should handle flow that exits with error", async () => {
      const flowDir = join(flowsRoot, "error-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(
        flowScript,
        `#!/bin/bash
echo "Error occurred" >&2
exit 1
`,
      );
      await chmod(flowScript, 0o755);

      const result = await executeFlowInitial({
        runId: "run-error",
        flowName: "error-flow",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
      });

      expect(result.processResult.exitCode).to.equal(1);
      expect(result.processResult.stderr).to.include("Error occurred");
      expect(result.response).to.be.null;
    });

    it("should handle flow that returns invalid JSON", async () => {
      const flowDir = join(flowsRoot, "invalid-json-flow");
      await mkdir(flowDir);
      const flowScript = join(flowDir, "flow.sh");
      await writeFile(
        flowScript,
        `#!/bin/bash
echo "Not valid JSON"
`,
      );
      await chmod(flowScript, 0o755);

      const result = await executeFlowInitial({
        runId: "run-invalid",
        flowName: "invalid-json-flow",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
      });

      expect(result.processResult.exitCode).to.equal(0);
      expect(result.response).to.be.null;
    });
  });

  describe("Step Executor", () => {
    it("should execute single step", async () => {
      // Create flow and step
      const flowDir = join(flowsRoot, "test-flow");
      await mkdir(flowDir);
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);
      const stepDir = join(stepsDir, "test-step");
      await mkdir(stepDir);
      const stepScript = join(stepDir, "step.sh");
      await writeFile(
        stepScript,
        `#!/bin/bash
echo "Step executed"
`,
      );
      await chmod(stepScript, 0o755);

      const result = await executeStep({
        runId: "run-123",
        flowName: "test-flow",
        stage: "test-stage",
        stepId: "test-step-0",
        stepName: "test-step",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
        processRegistry,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Step executed");
    });

    it("should pass step environment variables", async () => {
      const flowDir = join(flowsRoot, "env-flow");
      await mkdir(flowDir);
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);
      const stepDir = join(stepsDir, "env-step");
      await mkdir(stepDir);
      const stepScript = join(stepDir, "step.sh");
      await writeFile(
        stepScript,
        `#!/bin/bash
echo "RUN_ID=$MAXQ_RUN_ID"
echo "FLOW=$MAXQ_FLOW_NAME"
echo "STAGE=$MAXQ_STAGE"
echo "STEP=$MAXQ_STEP_NAME"
echo "SEQ=$MAXQ_STEP_SEQUENCE"
echo "API=$MAXQ_API"
echo "CUSTOM=$CUSTOM_VAR"
`,
      );
      await chmod(stepScript, 0o755);

      const result = await executeStep({
        runId: "run-456",
        flowName: "env-flow",
        stage: "my-stage",
        stepId: "env-step-2",
        stepName: "env-step",
        flowsRoot,
        apiUrl: "http://localhost:5003/api/v1",
        maxLogCapture: 8192,
        processRegistry,
        env: { CUSTOM_VAR: "custom-value" },
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("RUN_ID=run-456");
      expect(result.stdout).to.include("FLOW=env-flow");
      expect(result.stdout).to.include("STAGE=my-stage");
      expect(result.stdout).to.include("STEP=env-step");
      expect(result.stdout).to.include("API=http://localhost:5003/api/v1");
      expect(result.stdout).to.include("CUSTOM=custom-value");
    });
  });

  describe("DAG Execution", () => {
    beforeEach(async () => {
      // Create flow with multiple steps for DAG testing
      const flowDir = join(flowsRoot, "dag-flow");
      await mkdir(flowDir);
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);

      // Create steps that log their execution
      for (const stepName of [
        "init",
        "fetch-a",
        "fetch-b",
        "process-a",
        "process-b",
        "aggregate",
      ]) {
        const stepDir = join(stepsDir, stepName);
        await mkdir(stepDir);
        const stepScript = join(stepDir, "step.sh");
        await writeFile(
          stepScript,
          `#!/bin/bash
echo "Executing ${stepName}"
`,
        );
        await chmod(stepScript, 0o755);
      }
    });

    it("should execute steps in DAG order", async () => {
      const steps: StepDefinition[] = [
        { id: "init", name: "init" },
        { id: "fetch-a", name: "fetch-a", dependsOn: ["init"] },
        { id: "fetch-b", name: "fetch-b", dependsOn: ["init"] },
        { id: "process-a", name: "process-a", dependsOn: ["fetch-a"] },
        { id: "process-b", name: "process-b", dependsOn: ["fetch-b"] },
        {
          id: "aggregate",
          name: "aggregate",
          dependsOn: ["process-a", "process-b"],
        },
      ];

      const results = await executeStepsDAG(
        steps,
        "run-dag-1",
        "dag-flow",
        "dag-stage",
        flowsRoot,
        "http://localhost:5003/api/v1",
        8192,
        5,
        processRegistry,
        async (result) => {
          // Return final status based on exit code
          return {
            finalStatus:
              result.processResult.exitCode === 0 ? "completed" : "failed",
          };
        },
      );

      expect(results).to.have.lengthOf(6);

      // All steps should succeed
      for (const result of results) {
        expect(result.processResult.exitCode).to.equal(0);
      }

      // Check that all steps executed
      const executedSteps = results.map((r) => r.name).sort();
      expect(executedSteps).to.deep.equal([
        "aggregate",
        "fetch-a",
        "fetch-b",
        "init",
        "process-a",
        "process-b",
      ]);
    });

    it("should execute independent steps in parallel", async () => {
      const steps: StepDefinition[] = [
        { id: "init", name: "init" },
        { id: "fetch-a", name: "fetch-a", dependsOn: ["init"] },
        { id: "fetch-b", name: "fetch-b", dependsOn: ["init"] },
      ];

      const startTime = Date.now();
      const results = await executeStepsDAG(
        steps,
        "run-parallel",
        "dag-flow",
        "parallel-stage",
        flowsRoot,
        "http://localhost:5003/api/v1",
        8192,
        10,
        processRegistry,
        async (result) => {
          // Return final status based on exit code
          return {
            finalStatus:
              result.processResult.exitCode === 0 ? "completed" : "failed",
          };
        },
      );
      const duration = Date.now() - startTime;

      expect(results).to.have.lengthOf(3);

      // fetch-a and fetch-b should run in parallel
      // If they ran sequentially, it would take longer
      // This is a rough check - parallel execution should be faster
      expect(duration).to.be.lessThan(5000);
    });

    it("should stop DAG execution on step failure", async () => {
      // Create a failing step
      const failStepDir = join(flowsRoot, "dag-flow", "steps", "fail-step");
      await mkdir(failStepDir);
      const failScript = join(failStepDir, "step.sh");
      await writeFile(
        failScript,
        `#!/bin/bash
echo "Failing step"
exit 1
`,
      );
      await chmod(failScript, 0o755);

      const steps: StepDefinition[] = [
        { id: "init", name: "init" },
        { id: "fail-step", name: "fail-step", dependsOn: ["init"] },
        { id: "fetch-a", name: "fetch-a", dependsOn: ["init"] },
        {
          id: "aggregate",
          name: "aggregate",
          dependsOn: ["fail-step", "fetch-a"],
        },
      ];

      try {
        await executeStepsDAG(
          steps,
          "run-failure",
          "dag-flow",
          "failure-stage",
          flowsRoot,
          "http://localhost:5003/api/v1",
          8192,
          5,
          processRegistry,
          async (result) => {
            // Return final status based on exit code
            return {
              finalStatus:
                result.processResult.exitCode === 0 ? "completed" : "failed",
            };
          },
        );
        expect.fail("Should have thrown error");
      } catch (error) {
        expect((error as Error).message).to.include("Stage failed");
      }
    });

    it("should handle parallel execution with multiple step IDs", async () => {
      // Flow generates explicit IDs for parallel execution
      const steps: StepDefinition[] = [
        { id: "init-0", name: "init" },
        { id: "init-1", name: "init" },
        { id: "init-2", name: "init" },
      ];

      const results = await executeStepsDAG(
        steps,
        "run-instances",
        "dag-flow",
        "instances-stage",
        flowsRoot,
        "http://localhost:5003/api/v1",
        8192,
        10,
        processRegistry,
        async (result) => {
          // Return final status based on exit code
          return {
            finalStatus:
              result.processResult.exitCode === 0 ? "completed" : "failed",
          };
        },
      );

      // Should execute 3 steps
      expect(results).to.have.lengthOf(3);

      const ids = results.map((r) => r.id).sort();
      expect(ids).to.deep.equal(["init-0", "init-1", "init-2"]);

      // All instances should succeed
      for (const result of results) {
        expect(result.processResult.exitCode).to.equal(0);
        expect(result.name).to.equal("init");
      }
    });
  });

  describe("Retry Logic", () => {
    it("should retry failed step up to maxRetries", async () => {
      // Create flow and step
      const flowDir = join(flowsRoot, "retry-flow");
      await mkdir(flowDir);
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);

      // Create step that fails twice then succeeds
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
  echo "Failing attempt $COUNTER" >&2
  exit 1
fi

echo "Success on attempt $COUNTER"
exit 0
`,
      );
      await chmod(stepScript, 0o755);

      const steps: StepDefinition[] = [
        { id: "retry-step", name: "retry-step", maxRetries: 3 },
      ];

      const results = await executeStepsDAG(
        steps,
        "run-retry",
        "retry-flow",
        "retry-stage",
        flowsRoot,
        "http://localhost:5003/api/v1",
        8192,
        5,
        processRegistry,
        async (result) => {
          // Return final status based on exit code
          return {
            finalStatus:
              result.processResult.exitCode === 0 ? "completed" : "failed",
          };
        },
      );

      expect(results).to.have.lengthOf(1);
      const result = results[0]!;

      // Should eventually succeed
      expect(result!.processResult.exitCode).to.equal(0);
      expect(result!.processResult.stdout).to.include("Success on attempt 3");

      // Should have retried twice (retryCount = 2)
      expect(result!.retryCount).to.equal(2);
    });

    it("should fail after exhausting retries", async () => {
      // Create flow and step that always fails
      const flowDir = join(flowsRoot, "fail-flow");
      await mkdir(flowDir);
      const stepsDir = join(flowDir, "steps");
      await mkdir(stepsDir);
      const stepDir = join(stepsDir, "always-fail");
      await mkdir(stepDir);
      const stepScript = join(stepDir, "step.sh");
      await writeFile(
        stepScript,
        `#!/bin/bash
echo "Always failing"
exit 1
`,
      );
      await chmod(stepScript, 0o755);

      const steps: StepDefinition[] = [
        { id: "always-fail", name: "always-fail", maxRetries: 2 },
      ];

      try {
        await executeStepsDAG(
          steps,
          "run-exhaust",
          "fail-flow",
          "exhaust-stage",
          flowsRoot,
          "http://localhost:5003/api/v1",
          8192,
          5,
          processRegistry,
          async (result) => {
            // Return final status based on exit code
            return {
              finalStatus:
                result.processResult.exitCode === 0 ? "completed" : "failed",
            };
          },
        );
        expect.fail("Should have thrown error");
      } catch (error) {
        expect((error as Error).message).to.include("Stage failed");
      }
    });
  });
});
