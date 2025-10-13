/**
 * Registry for tracking running step processes
 * Allows killing processes during abort or server shutdown
 */

import type { ChildProcess } from "child_process";
import { createLogger } from "@codespin/maxq-logger";

const logger = createLogger("maxq:executor:process-registry");

export class StepProcessRegistry {
  private processes = new Map<string, ChildProcess>();

  /**
   * Register a running step process
   *
   * @param runId - Run ID
   * @param stepId - Step ID
   * @param process - Child process object
   */
  register(runId: string, stepId: string, process: ChildProcess): void {
    const key = `${runId}:${stepId}`;
    this.processes.set(key, process);
    logger.debug("Registered process", { runId, stepId, pid: process.pid });
  }

  /**
   * Unregister a step process (called when process completes)
   *
   * @param runId - Run ID
   * @param stepId - Step ID
   */
  unregister(runId: string, stepId: string): void {
    const key = `${runId}:${stepId}`;
    const removed = this.processes.delete(key);
    if (removed) {
      logger.debug("Unregistered process", { runId, stepId });
    }
  }

  /**
   * Get all processes for a run
   *
   * @param runId - Run ID
   * @returns Array of tuples [stepId, ChildProcess]
   */
  getProcessesForRun(runId: string): Array<[string, ChildProcess]> {
    const result: Array<[string, ChildProcess]> = [];
    for (const [key, process] of this.processes.entries()) {
      if (key.startsWith(`${runId}:`)) {
        const stepId = key.substring(runId.length + 1);
        result.push([stepId, process]);
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
    for (const [stepId, process] of processes) {
      try {
        if (process.pid) {
          logger.debug("Sending SIGTERM", {
            runId,
            stepId,
            pid: process.pid,
          });
          process.kill("SIGTERM");
        }
      } catch (error) {
        logger.warn("Failed to send SIGTERM", { runId, stepId, error });
      }
    }

    // Wait for grace period
    await new Promise((resolve) => setTimeout(resolve, graceMs));

    // Send SIGKILL to any surviving processes
    for (const [stepId, process] of processes) {
      try {
        if (process.pid && !process.killed) {
          logger.warn("Escalating to SIGKILL", {
            runId,
            stepId,
            pid: process.pid,
          });
          process.kill("SIGKILL");
        }
      } catch (error) {
        logger.warn("Failed to send SIGKILL", { runId, stepId, error });
      }
    }

    // Clean up registry entries
    for (const [stepId] of processes) {
      this.unregister(runId, stepId);
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
