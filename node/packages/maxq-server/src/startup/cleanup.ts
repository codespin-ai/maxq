/**
 * Server startup cleanup
 * Handles cleanup of interrupted workflows when server restarts
 */

import { spawn } from "child_process";
import { createLogger } from "@codespin/maxq-logger";
import { schema } from "@codespin/maxq-db";
import { executeSelect, executeUpdate } from "@tinqerjs/pg-promise-adapter";
import type { IDatabase } from "pg-promise";

const logger = createLogger("maxq:startup:cleanup");

/**
 * Kill all MaxQ processes found on the system
 * Searches for processes with MAXQ_RUN_ID environment variable
 *
 * @param graceMs - Grace period in milliseconds before escalating to SIGKILL
 */
async function killMaxQProcesses(graceMs: number): Promise<void> {
  logger.info("Searching for MaxQ processes to kill");

  // Find all processes with MAXQ_RUN_ID environment variable
  // Use ps with custom format to get PID and check environment
  const pids: number[] = [];

  try {
    // Get all process IDs
    const psOutput = await new Promise<string>((resolve, _reject) => {
      const proc = spawn("ps", ["-e", "-o", "pid="], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          _reject(new Error(`ps command failed: ${stderr}`));
        }
      });

      proc.on("error", (error) => {
        _reject(error);
      });
    });

    const allPids = psOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => parseInt(line, 10));

    // Check each process for MAXQ_RUN_ID in environment
    for (const pid of allPids) {
      try {
        // Read /proc/[pid]/environ to check for MAXQ_RUN_ID
        const envOutput = await new Promise<string>((resolve, _reject) => {
          const proc = spawn("cat", [`/proc/${pid}/environ`], {
            stdio: ["ignore", "pipe", "pipe"],
          });

          let stdout = "";

          proc.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });

          proc.on("close", (_code) => {
            resolve(stdout);
          });

          proc.on("error", () => {
            // Process might have exited, ignore
            resolve("");
          });
        });

        // Environment is null-separated
        const envVars = envOutput.split("\0");
        const hasMaxQRunId = envVars.some((env) =>
          env.startsWith("MAXQ_RUN_ID="),
        );

        if (hasMaxQRunId) {
          pids.push(pid);
          logger.debug("Found MaxQ process", { pid });
        }
      } catch {
        // Ignore errors (process might have exited)
        continue;
      }
    }

    if (pids.length === 0) {
      logger.info("No MaxQ processes found");
      return;
    }

    logger.info("Killing MaxQ processes", {
      count: pids.length,
      pids,
      graceMs,
    });

    // Send SIGTERM to all processes
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        logger.debug("Sent SIGTERM", { pid });
      } catch (error) {
        logger.warn("Failed to send SIGTERM", { pid, error });
      }
    }

    // Wait for grace period
    await new Promise((resolve) => setTimeout(resolve, graceMs));

    // Send SIGKILL to any surviving processes
    for (const pid of pids) {
      try {
        // Check if process still exists
        process.kill(pid, 0); // Signal 0 just checks if process exists
        // If we get here, process still exists
        process.kill(pid, "SIGKILL");
        logger.warn("Escalated to SIGKILL", { pid });
      } catch {
        // Process already exited, ignore
        logger.debug("Process already exited", { pid });
      }
    }

    logger.info("Completed killing MaxQ processes");
  } catch (error) {
    logger.error("Failed to kill MaxQ processes", { error });
    throw error;
  }
}

/**
 * Fail all interrupted runs, stages, and steps
 * Marks any pending or running entities as failed with termination_reason='server_restart'
 *
 * @param db - Database connection
 */
async function failInterruptedWork(db: IDatabase<unknown>): Promise<void> {
  logger.info("Failing interrupted work");

  const now = Date.now();
  const terminationReason = "server_restart";

  try {
    // Find all runs that are pending or running
    const interruptedRuns = await executeSelect(
      db,
      schema,
      (q) =>
        q
          .from("run")
          .where((r) => r.status === "pending" || r.status === "running"),
      {},
    );

    logger.info("Found interrupted runs", { count: interruptedRuns.length });

    // Fail each run and its stages/steps
    for (const run of interruptedRuns) {
      logger.info("Failing interrupted run", { runId: run.id });

      // Fail the run
      await executeUpdate(
        db,
        schema,
        (q, p) =>
          q
            .update("run")
            .set({
              status: "failed",
              termination_reason: p.terminationReason,
              completed_at: p.completedAt,
            })
            .where((r) => r.id === p.runId),
        {
          runId: run.id,
          terminationReason,
          completedAt: now,
        },
      );

      // Fail all pending/running stages for this run
      await executeUpdate(
        db,
        schema,
        (q, p) =>
          q
            .update("stage")
            .set({
              status: "failed",
              termination_reason: p.terminationReason,
              completed_at: p.completedAt,
            })
            .where(
              (s) =>
                s.run_id === p.runId &&
                (s.status === "pending" || s.status === "running"),
            ),
        {
          runId: run.id,
          terminationReason,
          completedAt: now,
        },
      );

      // Fail all pending/running steps for this run
      await executeUpdate(
        db,
        schema,
        (q, p) =>
          q
            .update("step")
            .set({
              status: "failed",
              termination_reason: p.terminationReason,
              completed_at: p.completedAt,
            })
            .where(
              (s) =>
                s.run_id === p.runId &&
                (s.status === "pending" || s.status === "running"),
            ),
        {
          runId: run.id,
          terminationReason,
          completedAt: now,
        },
      );

      logger.debug("Failed run and its stages/steps", { runId: run.id });
    }

    logger.info("Completed failing interrupted work", {
      runsAffected: interruptedRuns.length,
    });
  } catch (error) {
    logger.error("Failed to fail interrupted work", { error });
    throw error;
  }
}

/**
 * Perform startup cleanup
 * Kills all MaxQ processes and fails all interrupted work
 *
 * @param db - Database connection
 * @param graceMs - Grace period in milliseconds for process termination (default: 5000)
 */
export async function performStartupCleanup(
  db: IDatabase<unknown>,
  graceMs: number = 5000,
): Promise<void> {
  logger.info("Starting server startup cleanup", { graceMs });

  try {
    // First, kill all MaxQ processes
    await killMaxQProcesses(graceMs);

    // Then, fail all interrupted work in database
    await failInterruptedWork(db);

    logger.info("Server startup cleanup completed successfully");
  } catch (error) {
    logger.error("Server startup cleanup failed", { error });
    throw error;
  }
}
