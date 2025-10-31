/**
 * Security utilities for safe process execution
 * Prevents command injection and path traversal attacks
 */

import { resolve, sep } from "path";
import { access, constants } from "fs/promises";
import { createLogger } from "../lib/logger/index.js";

const logger = createLogger("maxq:executor:security");

// Only allow alphanumeric, underscore, and hyphen in flow/step names
const SAFE_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

// Only allow uppercase letters, numbers, and underscore in env var names
const SAFE_ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/i;

/**
 * Validate that a flow or step name is safe
 * Prevents directory traversal and command injection
 *
 * @param name - Flow or step name to validate
 * @param type - Type of name for error messages
 * @throws Error if name is invalid
 */
export function validateName(name: string, type: "flow" | "step"): void {
  if (!name || typeof name !== "string") {
    throw new Error(`${type} name must be a non-empty string`);
  }

  if (!SAFE_NAME_REGEX.test(name)) {
    logger.error("Invalid name detected", { name, type });
    throw new Error(
      `Invalid ${type} name: "${name}". Only alphanumeric, underscore, and hyphen allowed.`,
    );
  }

  // Prevent path traversal attempts
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    logger.error("Path traversal attempt detected", { name, type });
    throw new Error(`${type} name cannot contain path separators or "..""`);
  }
}

/**
 * Resolve a safe path within a base directory
 * Prevents path traversal attacks
 *
 * @param basePath - Base directory path
 * @param parts - Path parts to join
 * @returns Resolved absolute path
 * @throws Error if resolved path is outside base directory
 */
export function resolveSafePath(basePath: string, ...parts: string[]): string {
  // Resolve to absolute paths
  const resolvedBase = resolve(basePath);
  const resolvedPath = resolve(basePath, ...parts);

  // Ensure the resolved path is within the base path
  if (!resolvedPath.startsWith(resolvedBase + sep)) {
    logger.error("Path traversal attempt detected", {
      basePath,
      parts,
      resolvedPath,
    });
    throw new Error("Path traversal attempt detected");
  }

  return resolvedPath;
}

/**
 * Validate that a script is executable
 *
 * @param scriptPath - Path to the script
 * @throws Error if script is not executable or doesn't exist
 */
export async function validateExecutable(scriptPath: string): Promise<void> {
  try {
    // First check if file exists
    await access(scriptPath, constants.F_OK);
  } catch (error) {
    const nodeError = error as Error & { code?: string };
    if (nodeError.code === "ENOENT") {
      logger.error("Script does not exist", { scriptPath });
      throw new Error(`Script does not exist: ${scriptPath}`);
    }
    logger.error("Cannot access script", { scriptPath, error });
    throw new Error(`Cannot access script: ${scriptPath}`);
  }

  try {
    // Then check if it's executable
    await access(scriptPath, constants.X_OK);
  } catch (error) {
    logger.error("Script not executable", { scriptPath, error });
    throw new Error(
      `Script exists but is not executable: ${scriptPath}. Run: chmod +x ${scriptPath}`,
    );
  }
}

/**
 * Sanitize environment variables
 * Ensures env var names are safe and values are strings
 *
 * @param userEnv - User-provided environment variables
 * @returns Sanitized environment variables
 * @throws Error if any env var name is invalid
 */
export function sanitizeEnv(
  userEnv: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(userEnv)) {
    // Validate environment variable name
    if (!SAFE_ENV_KEY_REGEX.test(key)) {
      logger.error("Invalid environment variable name", { key });
      throw new Error(
        `Invalid environment variable name: "${key}". Only alphanumeric and underscore allowed, must start with letter or underscore.`,
      );
    }

    // Ensure value is a string (no objects/arrays)
    if (typeof value !== "string") {
      logger.warn("Converting non-string env value to string", { key });
    }

    sanitized[key] = String(value);
  }

  return sanitized;
}

/**
 * Build a safe execution path for a flow script
 *
 * @param flowsRoot - Root directory containing flows
 * @param flowName - Name of the flow
 * @returns Safe path to flow.sh
 * @throws Error if validation fails
 */
export function buildFlowPath(flowsRoot: string, flowName: string): string {
  validateName(flowName, "flow");
  return resolveSafePath(flowsRoot, flowName, "flow.sh");
}

/**
 * Build a safe execution path for a step script
 *
 * @param flowsRoot - Root directory containing flows
 * @param flowName - Name of the flow
 * @param stepName - Name of the step
 * @returns Safe path to step.sh
 * @throws Error if validation fails
 */
export function buildStepPath(
  flowsRoot: string,
  flowName: string,
  stepName: string,
): string {
  validateName(flowName, "flow");
  validateName(stepName, "step");
  return resolveSafePath(flowsRoot, flowName, "steps", stepName, "step.sh");
}
