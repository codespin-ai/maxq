import express, { Express, Request, Response } from "express";
import { Server } from "http";

interface PendingWaiter {
  signal: string;
  resolve: (value: boolean) => void;
  timeoutHandle: NodeJS.Timeout;
}

export interface TestSignalHubOptions {
  port?: number;
}

/**
 * HTTP-based signal hub for test synchronization.
 *
 * Features:
 * - Long-polling support: waiters block until signal arrives or timeout
 * - Signal isolation: signals are namespaced per test via testId
 * - Automatic cleanup: clearTest() removes all signals for a test
 * - Bidirectional: both tests and bash scripts can emit/wait for signals
 */
export class TestSignalHub {
  private app: Express;
  private server: Server | null = null;
  private port: number;

  // Map of testId -> signalName -> boolean
  private signals: Map<string, Map<string, boolean>> = new Map();

  // Map of testId -> signalName -> waiter[]
  private waiters: Map<string, Map<string, PendingWaiter[]>> = new Map();

  constructor(options: TestSignalHubOptions = {}) {
    this.port = options.port || 5098;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Emit a signal
    this.app.post(
      "/signal/:testId/:signalName",
      (req: Request, res: Response) => {
        const { testId, signalName } = req.params;

        if (!testId || !signalName) {
          res.status(400).json({ error: "testId and signalName required" });
          return;
        }

        // Store the signal
        if (!this.signals.has(testId)) {
          this.signals.set(testId, new Map());
        }
        this.signals.get(testId)!.set(signalName, true);

        // Resolve any pending waiters for this signal
        const testWaiters = this.waiters.get(testId);
        if (testWaiters) {
          const signalWaiters = testWaiters.get(signalName) || [];
          for (const waiter of signalWaiters) {
            clearTimeout(waiter.timeoutHandle);
            waiter.resolve(true);
          }
          testWaiters.delete(signalName);
        }

        res.status(200).json({ success: true });
      },
    );

    // Wait for a signal (long-polling)
    this.app.get(
      "/signal/:testId/:signalName",
      (req: Request, res: Response) => {
        const { testId, signalName } = req.params;
        const timeoutMs = parseInt(req.query.timeout as string) || 30000;

        if (!testId || !signalName) {
          res.status(400).json({ error: "testId and signalName required" });
          return;
        }

        // Check if signal already exists
        const testSignals = this.signals.get(testId);
        if (testSignals?.has(signalName)) {
          res.status(200).json({ signaled: true });
          return;
        }

        // Long-poll: wait for signal to arrive
        const promise = new Promise<boolean>((resolve) => {
          const timeoutHandle = setTimeout(() => {
            // Remove this waiter from the list
            const testWaiters = this.waiters.get(testId);
            if (testWaiters) {
              const signalWaiters = testWaiters.get(signalName);
              if (signalWaiters) {
                const index = signalWaiters.findIndex(
                  (w) => w.resolve === resolve,
                );
                if (index !== -1) {
                  signalWaiters.splice(index, 1);
                }
              }
            }
            resolve(false); // Timeout
          }, timeoutMs);

          const waiter: PendingWaiter = {
            signal: signalName,
            resolve,
            timeoutHandle,
          };

          // Add to waiters list
          if (!this.waiters.has(testId)) {
            this.waiters.set(testId, new Map());
          }
          const testWaiters = this.waiters.get(testId)!;
          if (!testWaiters.has(signalName)) {
            testWaiters.set(signalName, []);
          }
          testWaiters.get(signalName)!.push(waiter);
        });

        promise.then((signaled) => {
          if (signaled) {
            res.status(200).json({ signaled: true });
          } else {
            res.status(408).json({ signaled: false, error: "timeout" });
          }
        });
      },
    );

    // Clear all signals for a test
    this.app.delete("/signal/:testId", (req: Request, res: Response) => {
      const { testId } = req.params;

      if (!testId) {
        res.status(400).json({ error: "testId required" });
        return;
      }

      // Cancel all pending waiters for this test
      const testWaiters = this.waiters.get(testId);
      if (testWaiters) {
        for (const signalWaiters of testWaiters.values()) {
          for (const waiter of signalWaiters) {
            clearTimeout(waiter.timeoutHandle);
            waiter.resolve(false);
          }
        }
      }

      // Clear all signals and waiters
      this.signals.delete(testId);
      this.waiters.delete(testId);

      res.status(200).json({ success: true });
    });

    // Health check
    this.app.get("/health", (_req: Request, res: Response) => {
      res.status(200).json({ status: "ok" });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          resolve();
        });

        this.server.on("error", reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  getPort(): number {
    return this.port;
  }

  /**
   * TypeScript helper: emit a signal from test code
   */
  async emitSignal(testId: string, signalName: string): Promise<void> {
    const response = await fetch(
      `http://localhost:${this.port}/signal/${testId}/${signalName}`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to emit signal: ${response.statusText}`);
    }
  }

  /**
   * TypeScript helper: wait for a signal in test code
   */
  async waitForSignal(
    testId: string,
    signalName: string,
    timeoutMs: number = 30000,
  ): Promise<boolean> {
    const response = await fetch(
      `http://localhost:${this.port}/signal/${testId}/${signalName}?timeout=${timeoutMs}`,
      { method: "GET" },
    );

    const data = (await response.json()) as { signaled?: boolean };
    return data.signaled === true;
  }

  /**
   * TypeScript helper: clear all signals for a test (call in afterEach)
   */
  async clearTest(testId: string): Promise<void> {
    const response = await fetch(
      `http://localhost:${this.port}/signal/${testId}`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to clear test signals: ${response.statusText}`);
    }
  }
}
