/**
 * Flow discovery from filesystem
 * Discovers flows from FLOWS_ROOT directory structure
 */

import { readdir, access, constants, readFile } from "fs/promises";
import { join } from "path";
import { parse as parseYaml } from "yaml";
import { createLogger } from "@codespin/maxq-logger";
import type { FlowDiscovery } from "./types.js";

const logger = createLogger("maxq:executor:flow-discovery");

/**
 * Read flow metadata from flow.yaml if it exists
 *
 * @param flowPath - Path to the flow directory
 * @returns Flow title or undefined if not found
 */
async function readFlowMetadata(flowPath: string): Promise<string | undefined> {
  const flowYamlPath = join(flowPath, "flow.yaml");

  try {
    const yamlContent = await readFile(flowYamlPath, "utf-8");
    const metadata = parseYaml(yamlContent) as { title?: string };
    return metadata?.title;
  } catch {
    // flow.yaml is optional, don't log errors
    return undefined;
  }
}

/**
 * Discover all flows from the flows root directory
 *
 * @param flowsRoot - Root directory containing flows
 * @returns Array of discovered flows
 */
export async function discoverFlows(
  flowsRoot: string,
): Promise<FlowDiscovery[]> {
  try {
    const entries = await readdir(flowsRoot, { withFileTypes: true });
    const flows: FlowDiscovery[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const flowPath = join(flowsRoot, entry.name);
      const flowScriptPath = join(flowPath, "flow.sh");

      // Check if flow.sh exists
      try {
        await access(flowScriptPath, constants.X_OK);
      } catch {
        logger.debug("Skipping directory without executable flow.sh", {
          directory: entry.name,
        });
        continue;
      }

      // Discover steps
      const steps = await discoverSteps(flowPath);

      // Read flow metadata (title from flow.yaml)
      const title = await readFlowMetadata(flowPath);

      flows.push({
        name: entry.name,
        path: flowPath,
        steps,
        title,
      });

      logger.debug("Discovered flow", {
        name: entry.name,
        title,
        steps: steps.length,
      });
    }

    logger.info("Flow discovery completed", { count: flows.length });
    return flows;
  } catch (error) {
    logger.error("Failed to discover flows", { error, flowsRoot });
    return [];
  }
}

/**
 * Discover steps for a flow
 *
 * @param flowPath - Path to the flow directory
 * @returns Array of step names
 */
async function discoverSteps(flowPath: string): Promise<string[]> {
  const stepsDir = join(flowPath, "steps");

  try {
    const entries = await readdir(stepsDir, { withFileTypes: true });
    const steps: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const stepScriptPath = join(stepsDir, entry.name, "step.sh");

      // Check if step.sh exists and is executable
      try {
        await access(stepScriptPath, constants.X_OK);
        steps.push(entry.name);
      } catch {
        logger.debug("Skipping directory without executable step.sh", {
          directory: entry.name,
        });
      }
    }

    return steps;
  } catch (error) {
    logger.debug("No steps directory or error reading steps", {
      flowPath,
      error,
    });
    return [];
  }
}

/**
 * Get a specific flow by name
 *
 * @param flowsRoot - Root directory containing flows
 * @param flowName - Name of the flow
 * @returns Flow discovery result or null if not found
 */
export async function getFlow(
  flowsRoot: string,
  flowName: string,
): Promise<FlowDiscovery | null> {
  const flowPath = join(flowsRoot, flowName);
  const flowScriptPath = join(flowPath, "flow.sh");

  try {
    await access(flowScriptPath, constants.X_OK);
    const steps = await discoverSteps(flowPath);
    const title = await readFlowMetadata(flowPath);

    return {
      name: flowName,
      path: flowPath,
      steps,
      title,
    };
  } catch (error) {
    logger.warn("Flow not found or not executable", { flowName, error });
    return null;
  }
}

/**
 * Resolve the full path to a step script
 *
 * @param flowsRoot - Root directory containing flows
 * @param flowName - Name of the flow
 * @param stepName - Name of the step
 * @returns Full path to step.sh
 */
export function resolveStepPath(
  flowsRoot: string,
  flowName: string,
  stepName: string,
): string {
  return join(flowsRoot, flowName, "steps", stepName, "step.sh");
}
