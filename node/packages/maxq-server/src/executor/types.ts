/**
 * Executor types for MaxQ workflow orchestration
 */

export type FlowDiscovery = {
  name: string;
  path: string;
  steps: string[];
};

export type ExecutorConfig = {
  flowsRoot: string;
  maxLogCapture: number; // Max bytes to capture from stdout/stderr
  maxConcurrentSteps: number;
};

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};
