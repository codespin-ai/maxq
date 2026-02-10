/**
 * MaxQ Test Server
 *
 * Spawns and manages a MaxQ server process for integration testing.
 * Follows functional style - no classes.
 */

import { spawn, ChildProcess } from "child_process";
import { Logger, consoleLogger } from "./test-logger.js";

export type TestServerOptions = {
  port?: number;
  dataDir?: string;
  maxRetries?: number;
  retryDelay?: number;
  logger?: Logger;
  flowsRoot?: string;
  maxConcurrentSteps?: number;
};

export type TestServer = {
  process: ChildProcess | null;
  port: number;
  dataDir: string;
  maxRetries: number;
  retryDelay: number;
  logger: Logger;
  flowsRoot: string;
  maxConcurrentSteps: number;
};

function generateRandomPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152));
}

export function createTestServer(options: TestServerOptions = {}): TestServer {
  let port: number;
  if (options.port === 0) {
    port = generateRandomPort();
  } else {
    port = options.port || 5099;
  }

  return {
    process: null,
    port,
    dataDir: options.dataDir || `/tmp/maxq_test_${Date.now()}`,
    maxRetries: options.maxRetries || 30,
    retryDelay: options.retryDelay || 1000,
    logger: options.logger || consoleLogger,
    flowsRoot: options.flowsRoot || "./flows",
    maxConcurrentSteps: options.maxConcurrentSteps || 10,
  };
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    // Find process using the port
    const { execSync } = await import("child_process");
    const pid = execSync(`lsof -ti:${port} || true`).toString().trim();

    if (pid) {
      execSync(`kill -9 ${pid}`);
      // Wait a bit for the process to die
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch {
    // Ignore errors - port might already be free
  }
}

async function waitForServer(
  port: number,
  maxRetries: number,
  retryDelay: number,
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  throw new Error(`Server failed to start after ${maxRetries} attempts`);
}

export async function startTestServer(server: TestServer): Promise<void> {
  // Kill any process using the port first
  await killProcessOnPort(server.port);

  return new Promise((resolve, reject) => {
    // Set environment variables for test server
    const env = {
      ...process.env,
      NODE_ENV: "test",
      MAXQ_SERVER_PORT: server.port.toString(),
      MAXQ_DATA_DIR: server.dataDir,
      MAXQ_API_KEY: process.env.MAXQ_API_KEY || "test-token",
      MAXQ_FLOWS_ROOT: server.flowsRoot,
      MAXQ_MAX_CONCURRENT_STEPS: server.maxConcurrentSteps.toString(),
      MAXQ_SCHEDULER_INTERVAL_MS: "50", // Faster scheduler for tests
      MAXQ_SCHEDULER_BATCH_SIZE: "100", // Process more steps per iteration in tests
    };

    // Start the server directly
    const serverPath = new URL(
      "../../../maxq/dist/bin/server.js",
      import.meta.url,
    ).pathname;

    server.process = spawn("node", [serverPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: new URL("../../../maxq/dist/bin/", import.meta.url).pathname,
    });

    let serverStarted = false;

    server.process.stdout?.on("data", (data) => {
      const output = data.toString();
      console.log("[SERVER]", output.trim());

      if (output.includes("Server running") || output.includes("started")) {
        serverStarted = true;
        resolve();
      }
    });

    server.process.stderr?.on("data", (data) => {
      const output = data.toString().trim();
      if (output) {
        console.error("[SERVER]", output);
      }
    });

    server.process.on("error", (error) => {
      server.logger.error("Failed to start server:", error);
      reject(error);
    });

    server.process.on("exit", (code) => {
      if (!serverStarted && code !== 0) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Wait for server to be ready
    waitForServer(server.port, server.maxRetries, server.retryDelay)
      .then(() => {
        resolve();
      })
      .catch(reject);
  });
}

export async function stopTestServer(server: TestServer): Promise<void> {
  if (server.process) {
    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          server.process = null;
          resolve();
        }
      };

      server.process!.on("exit", cleanup);

      // Try graceful shutdown
      server.process!.kill("SIGTERM");

      // Force kill after 2 seconds and resolve
      setTimeout(async () => {
        if (server.process && !resolved) {
          server.process.kill("SIGKILL");
          await killProcessOnPort(server.port);
          setTimeout(cleanup, 100);
        }
      }, 2000);
    });
  }
}

export async function reconfigureTestServer(
  server: TestServer,
  options: Partial<TestServerOptions>,
): Promise<void> {
  if (options.flowsRoot !== undefined) {
    server.flowsRoot = options.flowsRoot;
  }
  if (options.port !== undefined) {
    if (options.port === 0) {
      server.port = generateRandomPort();
    } else {
      server.port = options.port;
    }
  }
  if (options.dataDir !== undefined) {
    server.dataDir = options.dataDir;
  }
  if (options.maxConcurrentSteps !== undefined) {
    server.maxConcurrentSteps = options.maxConcurrentSteps;
  }

  // Restart server with new configuration
  await stopTestServer(server);
  await startTestServer(server);
}
