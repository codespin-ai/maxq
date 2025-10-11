import { spawn, ChildProcess } from "child_process";
import { Logger, consoleLogger } from "./test-logger.js";

export interface TestServerOptions {
  port?: number;
  dbName?: string;
  maxRetries?: number;
  retryDelay?: number;
  logger?: Logger;
}

export class TestServer {
  private process: ChildProcess | null = null;
  private port: number;
  private dbName: string;
  private maxRetries: number;
  private retryDelay: number;
  private logger: Logger;

  constructor(options: TestServerOptions = {}) {
    this.port = options.port || 5099;
    this.dbName = options.dbName || "maxq_test";
    this.maxRetries = options.maxRetries || 30;
    this.retryDelay = options.retryDelay || 1000;
    this.logger = options.logger || consoleLogger;
  }

  private async killProcessOnPort(): Promise<void> {
    try {
      // Find process using the port
      const { execSync } = await import("child_process");
      const pid = execSync(`lsof -ti:${this.port} || true`).toString().trim();

      if (pid) {
        // Killing process using port
        execSync(`kill -9 ${pid}`);
        // Wait a bit for the process to die
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      // Ignore errors - port might already be free
    }
  }

  async start(): Promise<void> {
    // Kill any process using the port first
    await this.killProcessOnPort();

    return new Promise((resolve, reject) => {
      // Starting test server

      // Set environment variables for test server
      const dbHost = process.env.MAXQ_DB_HOST || "localhost";
      const dbPort = process.env.MAXQ_DB_PORT || "5432";
      const dbUser = process.env.MAXQ_DB_USER || "postgres";
      const dbPassword = process.env.MAXQ_DB_PASSWORD || "postgres";
      const databaseUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${this.dbName}`;

      const env = {
        ...process.env,
        NODE_ENV: "test",
        MAXQ_SERVER_PORT: this.port.toString(),
        MAXQ_DATABASE_URL: databaseUrl, // Constructed database URL for test database
        MAXQ_API_KEY: process.env.MAXQ_API_KEY || "test-token",
        MAXQ_FLOWS_ROOT: process.env.MAXQ_FLOWS_ROOT || "./flows",
      };

      // Start the server directly
      const serverPath = new URL(
        "../../../maxq-server/dist/index.js",
        import.meta.url,
      ).pathname;

      this.process = spawn("node", [serverPath], {
        env,
        stdio: ["ignore", "pipe", "inherit"], // Show stderr output directly
        cwd: new URL("../../../maxq-server/", import.meta.url).pathname,
      });

      let serverStarted = false;

      this.process.stdout?.on("data", (data) => {
        const output = data.toString();
        // Server output received

        // Check if server is ready
        if (output.includes("Server running") || output.includes("started")) {
          serverStarted = true;
          resolve(); // Resolve immediately when server is ready
        }
      });

      this.process.on("error", (error) => {
        this.logger.error("Failed to start server:", error);
        reject(error);
      });

      this.process.on("exit", (code) => {
        if (!serverStarted && code !== 0) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });

      // Wait for server to be ready
      this.waitForServer()
        .then(() => {
          // Test server is ready
          resolve();
        })
        .catch(reject);
    });
  }

  private async waitForServer(): Promise<void> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const response = await fetch(`http://localhost:${this.port}/health`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet
      }

      await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
    }

    throw new Error(`Server failed to start after ${this.maxRetries} attempts`);
  }

  async stop(): Promise<void> {
    if (this.process) {
      return new Promise((resolve) => {
        let resolved = false;

        const cleanup = () => {
          if (!resolved) {
            resolved = true;
            this.process = null;
            resolve();
          }
        };

        // Set up exit handler
        this.process!.on("exit", cleanup);

        // Try graceful shutdown
        this.process!.kill("SIGTERM");

        // Force kill after 2 seconds and resolve
        setTimeout(async () => {
          if (this.process && !resolved) {
            this.process.kill("SIGKILL");
            // Also kill any process on the port just to be sure
            await this.killProcessOnPort();
            // Give it a moment to actually die
            setTimeout(cleanup, 100);
          }
        }, 2000);
      });
    }
  }
}
