/**
 * Step executor - DAG resolution and parallel execution
 * Executes steps respecting dependencies with configurable concurrency
 */

import { createLogger } from "@codespin/maxq-logger";
import type { ProcessResult } from "./types.js";
import { buildStepPath } from "./security.js";
import { spawnProcess } from "./process-spawn.js";

const logger = createLogger("maxq:executor:step");

/**
 * Step definition from flow response
 */
export type StepDefinition = {
  id: string; // Unique step ID supplied by flow (e.g., "fetch-news", "analyzer-0")
  name: string; // Step script directory name (e.g., "fetch_news", "analyzer")
  dependsOn?: string[]; // Array of step IDs (not names)
  maxRetries?: number;
  env?: Record<string, string>;
};

/**
 * Step execution state
 */
type StepExecutionState = {
  id: string; // Unique step ID
  name: string; // Script directory name
  status: "pending" | "running" | "completed" | "failed";
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  env: Record<string, string>;
};

/**
 * Step execution result
 */
export type StepExecutionResult = {
  id: string; // Unique step ID
  name: string; // Script directory name
  processResult: ProcessResult;
  retryCount: number;
};

/**
 * Input for step execution
 */
export type StepExecutionInput = {
  runId: string;
  flowName: string;
  stage: string;
  stepId: string; // Unique step ID
  stepName: string; // Script directory name
  flowsRoot: string;
  apiUrl: string;
  maxLogCapture: number;
  env?: Record<string, string>;
  cwd?: string;
};

/**
 * Execute a single step instance
 *
 * @param input - Step execution parameters
 * @returns Process result
 */
export async function executeStep(
  input: StepExecutionInput,
): Promise<ProcessResult> {
  const {
    runId,
    flowName,
    stage,
    stepId,
    stepName,
    flowsRoot,
    apiUrl,
    maxLogCapture,
    env: userEnv,
    cwd,
  } = input;

  logger.info("Executing step", {
    runId,
    flowName,
    stage,
    stepId,
    stepName,
  });

  // Build safe path to step.sh
  const stepPath = buildStepPath(flowsRoot, flowName, stepName);

  // Prepare environment variables for step.sh
  const env: Record<string, string> = {
    MAXQ_RUN_ID: runId,
    MAXQ_FLOW_NAME: flowName,
    MAXQ_STAGE: stage,
    MAXQ_STEP_ID: stepId,
    MAXQ_STEP_NAME: stepName,
    MAXQ_API: apiUrl,
    ...(userEnv || {}),
  };

  logger.debug("Spawning step process", { stepPath, env });

  // Spawn step.sh and capture output
  const processResult = await spawnProcess(
    stepPath,
    env,
    cwd || flowsRoot,
    maxLogCapture,
  );

  logger.debug("Step process completed", {
    stepId,
    stepName,
    exitCode: processResult.exitCode,
    stdoutLength: processResult.stdout.length,
    stderrLength: processResult.stderr.length,
    durationMs: processResult.durationMs,
  });

  return processResult;
}

/**
 * Resolve DAG dependencies and determine execution order
 * Uses topological sort to find valid execution order
 *
 * @param steps - Step definitions with dependencies
 * @returns Ordered groups of steps that can run in parallel
 * @throws Error if circular dependencies detected
 */
export function resolveDAG(steps: StepDefinition[]): StepDefinition[][] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize in-degree and adjacency list
  for (const step of steps) {
    inDegree.set(step.id, 0);
    adjList.set(step.id, []);
  }

  // Build graph
  for (const step of steps) {
    const deps = step.dependsOn || [];
    inDegree.set(step.id, deps.length);

    for (const dep of deps) {
      if (!stepMap.has(dep)) {
        throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
      }
      adjList.get(dep)!.push(step.id);
    }
  }

  // Topological sort with levels (for parallel execution)
  const result: StepDefinition[][] = [];
  const remaining = new Set(steps.map((s) => s.id));

  while (remaining.size > 0) {
    // Find all steps with no remaining dependencies
    const ready = Array.from(remaining).filter((id) => inDegree.get(id) === 0);

    if (ready.length === 0) {
      throw new Error(
        `Circular dependency detected among steps: ${Array.from(remaining).join(", ")}`,
      );
    }

    // Add ready steps to current level
    result.push(ready.map((id) => stepMap.get(id)!));

    // Remove ready steps and update in-degrees
    for (const id of ready) {
      remaining.delete(id);
      for (const dependent of adjList.get(id)!) {
        inDegree.set(dependent, inDegree.get(dependent)! - 1);
      }
    }
  }

  logger.debug("DAG resolved", {
    totalSteps: steps.length,
    levels: result.length,
    parallelism: result.map((level) => level.length),
  });

  return result;
}

/**
 * Execute steps in DAG order with parallel execution within levels
 * Respects maxConcurrentSteps limit and retries failed steps
 *
 * @param steps - Step definitions
 * @param runId - Run ID
 * @param flowName - Flow name
 * @param stage - Stage name
 * @param flowsRoot - Flows root directory
 * @param apiUrl - API URL for callbacks
 * @param maxLogCapture - Max bytes to capture from stdout/stderr
 * @param maxConcurrentSteps - Max concurrent step executions
 * @param onStepComplete - Callback when step completes (for storing in DB)
 * @returns Array of all step execution results
 */
export async function executeStepsDAG(
  steps: StepDefinition[],
  runId: string,
  flowName: string,
  stage: string,
  flowsRoot: string,
  apiUrl: string,
  maxLogCapture: number,
  maxConcurrentSteps: number,
  onStepComplete: (result: StepExecutionResult) => Promise<void>,
): Promise<StepExecutionResult[]> {
  logger.info("Executing steps with DAG", {
    runId,
    stage,
    stepCount: steps.length,
    maxConcurrentSteps,
  });

  // Resolve DAG to get execution levels
  const levels = resolveDAG(steps);

  const allResults: StepExecutionResult[] = [];

  // Execute each level in sequence
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const level = levels[levelIndex];
    if (!level) {
      continue;
    }

    logger.info("Executing DAG level", {
      level: levelIndex + 1,
      totalLevels: levels.length,
      stepsInLevel: level.length,
    });

    // Create execution state for all steps in this level
    const executions: StepExecutionState[] = level.map((step) => ({
      id: step.id,
      name: step.name,
      status: "pending" as const,
      dependsOn: step.dependsOn || [],
      retryCount: 0,
      maxRetries: step.maxRetries || 0,
      env: step.env || {},
    }));

    // Execute all steps in parallel (with concurrency limit)
    const levelResults = await executeWithConcurrency(
      executions,
      maxConcurrentSteps,
      async (exec) => {
        let lastError: ProcessResult | null = null;

        // Retry loop
        for (
          let attempt = 0;
          attempt <= exec.maxRetries && exec.status !== "completed";
          attempt++
        ) {
          if (attempt > 0) {
            logger.info("Retrying step", {
              stepId: exec.id,
              stepName: exec.name,
              attempt,
              maxRetries: exec.maxRetries,
            });
          }

          exec.status = "running";
          exec.retryCount = attempt;

          const processResult = await executeStep({
            runId,
            flowName,
            stage,
            stepId: exec.id,
            stepName: exec.name,
            flowsRoot,
            apiUrl,
            maxLogCapture,
            env: exec.env,
          });

          const result: StepExecutionResult = {
            id: exec.id,
            name: exec.name,
            processResult,
            retryCount: exec.retryCount,
          };

          // Store result after each attempt (including retries)
          await onStepComplete(result);

          if (processResult.exitCode === 0) {
            exec.status = "completed";
            return result;
          } else {
            lastError = processResult;
            exec.status = "failed";
          }
        }

        // All retries exhausted
        logger.error("Step failed after all retries", {
          stepId: exec.id,
          stepName: exec.name,
          retries: exec.retryCount,
        });

        return {
          id: exec.id,
          name: exec.name,
          processResult: lastError!,
          retryCount: exec.retryCount,
        };
      },
    );

    allResults.push(...levelResults);

    // Check if any step failed in this level
    const failedSteps = levelResults.filter(
      (r) => r.processResult.exitCode !== 0,
    );
    if (failedSteps.length > 0) {
      logger.error("Steps failed in level, aborting stage", {
        level: levelIndex + 1,
        failedCount: failedSteps.length,
        failedSteps: failedSteps.map((r) => `${r.id} (${r.name})`),
      });
      throw new Error(
        `Stage failed: ${failedSteps.length} step(s) failed in level ${levelIndex + 1}`,
      );
    }
  }

  logger.info("All steps completed successfully", {
    runId,
    stage,
    totalSteps: allResults.length,
  });

  return allResults;
}

/**
 * Execute tasks with concurrency limit
 * Executes promises in parallel up to maxConcurrency limit
 *
 * @param items - Items to process
 * @param maxConcurrency - Max concurrent executions
 * @param executor - Function to execute for each item
 * @returns Results in original order
 */
async function executeWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  executor: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(items.length);
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) {
      continue;
    }

    const promise = executor(item).then((result) => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
      const completedIndex = executing.findIndex((p) => p === promise);
      if (completedIndex !== -1) {
        executing.splice(completedIndex, 1);
      }
    }
  }

  await Promise.all(executing);
  return results.filter((r): r is R => r !== undefined);
}
