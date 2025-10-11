/**
 * Process spawning with stdout/stderr capture
 * Spawns shell processes and captures their output with size limits
 * SECURITY: Never uses shell mode to prevent command injection
 */

import { spawn } from "child_process";
import { isAbsolute, resolve as resolvePath } from "path";
import { createLogger } from "@codespin/maxq-logger";
import type { ProcessResult } from "./types.js";
import { validateExecutable, sanitizeEnv } from "./security.js";

const logger = createLogger("maxq:executor:process-spawn");

/**
 * Spawn a process and capture stdout/stderr with size limits
 * SECURITY: Validates script path and sanitizes environment variables
 *
 * @param scriptPath - Path to the script to execute (must be absolute)
 * @param env - Environment variables for the process
 * @param cwd - Working directory for the process
 * @param maxLogCapture - Maximum bytes to capture from each stream
 * @returns Process execution result
 */
export async function spawnProcess(
  scriptPath: string,
  env: Record<string, string>,
  cwd: string,
  maxLogCapture: number = 8192,
): Promise<ProcessResult> {
  const startTime = Date.now();

  // SECURITY: Validate that script exists and is executable
  await validateExecutable(scriptPath);

  // SECURITY: Sanitize environment variables
  const safeEnv = sanitizeEnv(env);

  // SECURITY: Ensure we have an absolute path
  const absolutePath = isAbsolute(scriptPath)
    ? scriptPath
    : resolvePath(scriptPath);

  return new Promise((resolvePromise) => {
    // SECURITY: NEVER use shell: true to prevent command injection
    const proc = spawn(absolutePath, [], {
      cwd,
      env: { ...process.env, ...safeEnv },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false, // CRITICAL: Never enable shell
    });

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Capture stdout with size limit
    proc.stdout?.on("data", (chunk: Buffer) => {
      const str = chunk.toString("utf-8");
      if (stdout.length < maxLogCapture) {
        const remaining = maxLogCapture - stdout.length;
        stdout += str.slice(0, remaining);
        if (str.length > remaining) {
          stdoutTruncated = true;
        }
      }
    });

    // Capture stderr with size limit
    proc.stderr?.on("data", (chunk: Buffer) => {
      const str = chunk.toString("utf-8");
      if (stderr.length < maxLogCapture) {
        const remaining = maxLogCapture - stderr.length;
        stderr += str.slice(0, remaining);
        if (str.length > remaining) {
          stderrTruncated = true;
        }
      }
    });

    // Handle process exit
    proc.on("close", (code) => {
      const durationMs = Date.now() - startTime;

      // Add truncation markers if output was truncated
      if (stdoutTruncated) {
        stdout += `\n... (output truncated at ${maxLogCapture} bytes)`;
      }
      if (stderrTruncated) {
        stderr += `\n... (output truncated at ${maxLogCapture} bytes)`;
      }

      logger.debug("Process completed", {
        scriptPath,
        exitCode: code || 0,
        durationMs,
        stdoutBytes: stdout.length,
        stderrBytes: stderr.length,
      });

      resolvePromise({
        exitCode: code || 0,
        stdout,
        stderr,
        durationMs,
      });
    });

    // Handle process errors
    proc.on("error", (error) => {
      const durationMs = Date.now() - startTime;

      logger.error("Process error", { scriptPath, error });

      resolvePromise({
        exitCode: 1,
        stdout,
        stderr: stderr + `\nProcess error: ${error.message}`,
        durationMs,
      });
    });
  });
}
