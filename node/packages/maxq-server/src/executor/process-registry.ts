/**
 * Registry for tracking running flow and step processes
 * Allows killing processes during abort or server shutdown
 */

import type { ChildProcess } from "child_process";
import { createLogger } from "@codespin/maxq-logger";

const logger = createLogger("maxq:executor:process-registry");

export type ProcessType = "flow" | "step";

export class StepProcessRegistry {
  private processes = new Map<string, ChildProcess>();

  /**
   * Register a running process (flow or step)
   *
   * @param runId - Run ID
   * @param type - Process type ("flow" or "step")
   * @param process - Child process object
   * @param stepId - Step ID (required for type="step", ignored for type="flow")
   */
  register(
    runId: string,
    type: ProcessType,
    process: ChildProcess,
    stepId?: string,
  ): void {
    const key = type === "flow" ? `${runId}:flow` : `${runId}:step:${stepId}`;
    this.processes.set(key, process);
    logger.debug("Registered process", {
      runId,
      type,
      stepId,
      pid: process.pid,
    });
  }

  /**
   * Unregister a process (called when process completes)
   *
   * @param runId - Run ID
   * @param type - Process type ("flow" or "step")
   * @param stepId - Step ID (required for type="step", ignored for type="flow")
   */
  unregister(runId: string, type: ProcessType, stepId?: string): void {
    const key = type === "flow" ? `${runId}:flow` : `${runId}:step:${stepId}`;
    const removed = this.processes.delete(key);
    if (removed) {
      logger.debug("Unregistered process", { runId, type, stepId });
    }
  }

  /**
   * Get all processes for a run
   *
   * @param runId - Run ID
   * @returns Array of tuples [type, stepId?, ChildProcess]
   */
  getProcessesForRun(
    runId: string,
  ): Array<[ProcessType, string | undefined, ChildProcess]> {
    const result: Array<[ProcessType, string | undefined, ChildProcess]> = [];
    for (const [key, process] of this.processes.entries()) {
      if (key.startsWith(`${runId}:`)) {
        if (key === `${runId}:flow`) {
          result.push(["flow", undefined, process]);
        } else if (key.startsWith(`${runId}:step:`)) {
          const stepId = key.substring(`${runId}:step:`.length);
          result.push(["step", stepId, process]);
        }
      }
    }
    return result;
  }

  /**
   * Kill all processes for a run
   *
   * @param runId - Run ID
   * @param graceMs - Grace period in milliseconds before SIGKILL
   * @returns Promise that resolves when all processes are killed
   */
  async killProcessesForRun(runId: string, graceMs: number): Promise<void> {
    const processes = this.getProcessesForRun(runId);

    if (processes.length === 0) {
      logger.debug("No processes to kill for run", { runId });
      return;
    }

    logger.info("Killing processes for run", {
      runId,
      count: processes.length,
      graceMs,
    });

    // Send SIGTERM to all processes
    for (const [type, stepId, process] of processes) {
      try {
        if (process.pid) {
          logger.debug("Sending SIGTERM", {
            runId,
            type,
            stepId,
            pid: process.pid,
          });
          process.kill("SIGTERM");
        }
      } catch (error) {
        logger.warn("Failed to send SIGTERM", { runId, type, stepId, error });
      }
    }

    // Wait for grace period
    await new Promise((resolve) => setTimeout(resolve, graceMs));

    // Send SIGKILL to any surviving processes
    for (const [type, stepId, process] of processes) {
      try {
        if (process.pid && !process.killed) {
          logger.warn("Escalating to SIGKILL", {
            runId,
            type,
            stepId,
            pid: process.pid,
          });
          process.kill("SIGKILL");
        }
      } catch (error) {
        logger.warn("Failed to send SIGKILL", { runId, type, stepId, error });
      }
    }

    // Clean up registry entries
    for (const [type, stepId] of processes) {
      this.unregister(runId, type, stepId);
    }

    logger.info("Completed killing processes for run", { runId });
  }

  /**
   * Get count of registered processes
   *
   * @returns Number of currently registered processes
   */
  getProcessCount(): number {
    return this.processes.size;
  }

  /**
   * Get all process keys (for debugging)
   *
   * @returns Array of process keys
   */
  getAllKeys(): string[] {
    return Array.from(this.processes.keys());
  }
}
