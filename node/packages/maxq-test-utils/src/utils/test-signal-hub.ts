import express, { Express, Request, Response } from "express";
import { Server } from "http";

interface SignalEvent {
  seq: number;
  ts: number;
  payload?: unknown;
}

interface PendingWaiter {
  signal: string;
  resolve: (value: SignalEvent | null) => void;
  timeoutHandle: NodeJS.Timeout;
  baselineSeq: number;
}

export interface TestSignalHubOptions {
  port?: number;
}

export class SignalTimeoutError extends Error {
  constructor(
    public signal: string,
    public timeout: number,
    public testId: string,
  ) {
    super(
      `Signal timeout waiting for '${signal}' in test '${testId}' after ${timeout}ms`,
    );
    this.name = "SignalTimeoutError";
  }
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

  // Map of testId -> signalName -> event[]
  private events: Map<string, Map<string, SignalEvent[]>> = new Map();

  // Map of testId -> signalName -> waiter[]
  private waiters: Map<string, Map<string, PendingWaiter[]>> = new Map();

  // Global sequence counter per testId+signal
  private sequences: Map<string, Map<string, number>> = new Map();

  constructor(options: TestSignalHubOptions = {}) {
    this.port = options.port || 5098;
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Emit a signal (with optional payload)
    this.app.post(
      "/signal/:testId/:signalName",
      (req: Request, res: Response) => {
        const { testId, signalName } = req.params;
        const payload = req.body?.payload;

        if (!testId || !signalName) {
          res.status(400).json({ error: "testId and signalName required" });
          return;
        }

        // Get or initialize sequence counter
        if (!this.sequences.has(testId)) {
          this.sequences.set(testId, new Map());
        }
        const testSeqs = this.sequences.get(testId)!;
        const currentSeq = (testSeqs.get(signalName) || 0) + 1;
        testSeqs.set(signalName, currentSeq);

        // Create event
        const event: SignalEvent = {
          seq: currentSeq,
          ts: Date.now(),
          payload,
        };

        // Store the event
        if (!this.events.has(testId)) {
          this.events.set(testId, new Map());
        }
        const testEvents = this.events.get(testId)!;
        if (!testEvents.has(signalName)) {
          testEvents.set(signalName, []);
        }
        testEvents.get(signalName)!.push(event);

        // Resolve any pending waiters for this signal
        const testWaiters = this.waiters.get(testId);
        if (testWaiters) {
          const signalWaiters = testWaiters.get(signalName) || [];
          for (const waiter of signalWaiters) {
            // Only resolve if this event's seq is greater than waiter's baseline
            if (event.seq > waiter.baselineSeq) {
              clearTimeout(waiter.timeoutHandle);
              waiter.resolve(event);
            }
          }
          // Remove resolved waiters
          const remaining = signalWaiters.filter(
            (w) => event.seq <= w.baselineSeq,
          );
          if (remaining.length > 0) {
            testWaiters.set(signalName, remaining);
          } else {
            testWaiters.delete(signalName);
          }
        }

        res.status(200).json({ success: true, seq: currentSeq, ts: event.ts });
      },
    );

    // Wait for a signal (long-polling with baseline sequence)
    this.app.post(
      "/signal/:testId/:signalName/wait",
      (req: Request, res: Response) => {
        const { testId, signalName } = req.params;
        const timeoutMs = req.body?.timeout || 30000;
        const baselineSeq = req.body?.baselineSeq || 0;

        if (!testId || !signalName) {
          res.status(400).json({ error: "testId and signalName required" });
          return;
        }

        // Check if event already exists with seq > baseline
        const testEvents = this.events.get(testId);
        const events = testEvents?.get(signalName) || [];
        const existingEvent = events.find((e) => e.seq > baselineSeq);
        if (existingEvent) {
          res.status(200).json({
            signaled: true,
            event: existingEvent,
          });
          return;
        }

        // Long-poll: wait for signal to arrive
        const promise = new Promise<SignalEvent | null>((resolve) => {
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
            resolve(null); // Timeout
          }, timeoutMs);

          const waiter: PendingWaiter = {
            signal: signalName,
            resolve,
            timeoutHandle,
            baselineSeq,
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

        promise.then((event) => {
          if (event) {
            res.status(200).json({ signaled: true, event });
          } else {
            res.status(408).json({ signaled: false, error: "timeout" });
          }
        });
      },
    );

    // Wait for multiple signals (AND wait)
    this.app.post("/signal/:testId/wait-all", (req: Request, res: Response) => {
      const { testId } = req.params;
      const { signals: signalNames, timeout = 30000 } = req.body;

      if (!testId || !Array.isArray(signalNames) || signalNames.length === 0) {
        res.status(400).json({ error: "testId and signals array required" });
        return;
      }

      // Check if all signals already exist
      const testEvents = this.events.get(testId);
      const allExist =
        testEvents &&
        signalNames.every((name) => {
          const events = testEvents.get(name);
          return events && events.length > 0;
        });

      if (allExist && testEvents) {
        const events: Record<string, SignalEvent> = {};
        for (const name of signalNames) {
          const signalEvents = testEvents.get(name);
          if (signalEvents && signalEvents.length > 0) {
            const lastEvent = signalEvents[signalEvents.length - 1];
            if (lastEvent) {
              events[name] = lastEvent;
            }
          }
        }
        res.status(200).json({ signaled: true, events });
        return;
      }

      // Set up wait-all promise
      const remainingSignals = new Set(signalNames);
      const receivedEvents: Record<string, SignalEvent> = {};
      let timeoutHandle: NodeJS.Timeout;
      let resolved = false;

      const checkComplete = () => {
        if (resolved) return;
        if (remainingSignals.size === 0) {
          resolved = true;
          clearTimeout(timeoutHandle);
          res.status(200).json({ signaled: true, events: receivedEvents });
        }
      };

      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          res.status(408).json({
            signaled: false,
            error: "timeout",
            remaining: Array.from(remainingSignals),
          });
        }
      }, timeout);

      // Set up waiters for each missing signal
      for (const signalName of signalNames) {
        const waiter: PendingWaiter = {
          signal: signalName,
          resolve: (event) => {
            if (event && !resolved) {
              receivedEvents[signalName] = event;
              remainingSignals.delete(signalName);
              checkComplete();
            }
          },
          timeoutHandle,
          baselineSeq: 0,
        };

        if (!this.waiters.has(testId)) {
          this.waiters.set(testId, new Map());
        }
        const testWaiters = this.waiters.get(testId)!;
        if (!testWaiters.has(signalName)) {
          testWaiters.set(signalName, []);
        }
        testWaiters.get(signalName)!.push(waiter);
      }
    });

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
            waiter.resolve(null);
          }
        }
      }

      // Clear all events, signals, sequences, and waiters
      this.events.delete(testId);
      this.sequences.delete(testId);
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
  async emitSignal(
    testId: string,
    signalName: string,
    payload?: unknown,
  ): Promise<{ seq: number; ts: number }> {
    const response = await fetch(
      `http://localhost:${this.port}/signal/${testId}/${signalName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to emit signal: ${response.statusText}`);
    }

    const data = (await response.json()) as { seq: number; ts: number };
    return { seq: data.seq, ts: data.ts };
  }

  /**
   * TypeScript helper: wait for a signal in test code
   */
  async waitForSignal(
    testId: string,
    signalName: string,
    options: { timeout?: number; baselineSeq?: number } = {},
  ): Promise<SignalEvent> {
    const { timeout = 30000, baselineSeq = 0 } = options;

    const response = await fetch(
      `http://localhost:${this.port}/signal/${testId}/${signalName}/wait`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeout, baselineSeq }),
      },
    );

    const data = (await response.json()) as {
      signaled?: boolean;
      event?: SignalEvent;
    };

    if (response.status === 408 || !data.signaled || !data.event) {
      throw new SignalTimeoutError(signalName, timeout, testId);
    }

    return data.event;
  }

  /**
   * TypeScript helper: wait for multiple signals (AND wait)
   */
  async waitForAll(
    testId: string,
    signalNames: string[],
    timeout: number = 30000,
  ): Promise<Record<string, SignalEvent>> {
    const response = await fetch(
      `http://localhost:${this.port}/signal/${testId}/wait-all`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signals: signalNames, timeout }),
      },
    );

    const data = (await response.json()) as {
      signaled?: boolean;
      events?: Record<string, SignalEvent>;
      remaining?: string[];
    };

    if (response.status === 408 || !data.signaled || !data.events) {
      const remaining = data.remaining?.join(", ") || "unknown";
      throw new Error(
        `Timeout waiting for signals in test '${testId}': missing ${remaining}`,
      );
    }

    return data.events;
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

  /**
   * Create a namespaced signal client for a specific test
   */
  forTest(testId: string) {
    return {
      emit: (signalName: string, payload?: unknown) =>
        this.emitSignal(testId, signalName, payload),
      wait: (
        signalName: string,
        options?: { timeout?: number; baselineSeq?: number },
      ) => this.waitForSignal(testId, signalName, options),
      waitAll: (signalNames: string[], timeout?: number) =>
        this.waitForAll(testId, signalNames, timeout),
      clear: () => this.clearTest(testId),
    };
  }
}
