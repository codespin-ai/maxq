/**
 * Flow executor - spawns flow.sh and handles stage callbacks
 * Captures stdout/stderr and parses JSON responses
 */

import { createLogger } from "@codespin/maxq-logger";
import type { ProcessResult } from "./types.js";
import { buildFlowPath } from "./security.js";
import { spawnProcess } from "./process-spawn.js";

const logger = createLogger("maxq:executor:flow");

/**
 * Flow response from flow.sh stdout
 * Expected JSON format from flow.sh
 */
export type FlowResponse = {
  stage: string;
  final?: boolean;
  steps: Array<{
    name: string;
    dependsOn?: string[];
    instances?: number;
    maxRetries?: number;
    env?: Record<string, string>;
  }>;
};

/**
 * Input for flow execution
 */
export type FlowExecutionInput = {
  runId: string;
  flowName: string;
  flowsRoot: string;
  apiUrl: string;
  maxLogCapture: number;
  completedStage?: string;
  failedStage?: string;
  cwd?: string;
};

/**
 * Result of flow execution
 */
export type FlowExecutionResult = {
  response: FlowResponse | null;
  processResult: ProcessResult;
};

/**
 * Execute a flow by spawning flow.sh
 * Handles both initial execution and stage completion callbacks
 *
 * @param input - Flow execution parameters
 * @returns Flow response and process result
 */
export async function executeFlow(
  input: FlowExecutionInput,
): Promise<FlowExecutionResult> {
  const {
    runId,
    flowName,
    flowsRoot,
    apiUrl,
    maxLogCapture,
    completedStage,
    failedStage,
    cwd,
  } = input;

  logger.info("Executing flow", {
    runId,
    flowName,
    completedStage,
    failedStage,
  });

  // Build safe path to flow.sh
  const flowPath = buildFlowPath(flowsRoot, flowName);

  // Prepare environment variables for flow.sh
  const env: Record<string, string> = {
    MAXQ_RUN_ID: runId,
    MAXQ_FLOW_NAME: flowName,
    MAXQ_API: apiUrl,
  };

  // Add optional environment variables
  if (completedStage) {
    env.MAXQ_COMPLETED_STAGE = completedStage;
  }
  if (failedStage) {
    env.MAXQ_FAILED_STAGE = failedStage;
  }

  logger.debug("Spawning flow process", { flowPath, env });

  // Spawn flow.sh and capture output
  const processResult = await spawnProcess(
    flowPath,
    env,
    cwd || flowsRoot,
    maxLogCapture,
  );

  logger.debug("Flow process completed", {
    exitCode: processResult.exitCode,
    stdoutLength: processResult.stdout.length,
    stderrLength: processResult.stderr.length,
    durationMs: processResult.durationMs,
  });

  // Parse JSON response from stdout
  let response: FlowResponse | null = null;
  if (processResult.exitCode === 0 && processResult.stdout.trim()) {
    try {
      response = JSON.parse(processResult.stdout) as FlowResponse;
      logger.info("Flow response parsed", {
        stage: response.stage,
        final: response.final,
        stepCount: response.steps.length,
      });
    } catch (error) {
      logger.error("Failed to parse flow response", {
        error,
        stdout: processResult.stdout,
      });
    }
  } else if (processResult.exitCode !== 0) {
    logger.error("Flow execution failed", {
      exitCode: processResult.exitCode,
      stderr: processResult.stderr,
    });
  }

  return {
    response,
    processResult,
  };
}

/**
 * Execute flow for initial run creation
 * Convenience wrapper for executeFlow with no completed/failed stage
 *
 * @param input - Flow execution parameters
 * @returns Flow response and process result
 */
export async function executeFlowInitial(
  input: Omit<FlowExecutionInput, "completedStage" | "failedStage">,
): Promise<FlowExecutionResult> {
  return executeFlow(input);
}

/**
 * Execute flow for stage completion callback
 * Convenience wrapper for executeFlow with completed stage
 *
 * @param input - Flow execution parameters with completed stage
 * @returns Flow response and process result
 */
export async function executeFlowStageCompleted(
  input: Omit<FlowExecutionInput, "failedStage"> & { completedStage: string },
): Promise<FlowExecutionResult> {
  return executeFlow(input);
}

/**
 * Execute flow for stage failure callback
 * Convenience wrapper for executeFlow with failed stage
 *
 * @param input - Flow execution parameters with failed stage
 * @returns Flow response and process result
 */
export async function executeFlowStageFailed(
  input: Omit<FlowExecutionInput, "completedStage"> & { failedStage: string },
): Promise<FlowExecutionResult> {
  return executeFlow(input);
}
