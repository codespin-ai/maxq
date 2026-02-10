import {
  type TestDatabase,
  type TestServer,
  type TestHttpClient,
  getTestDatabaseInstance,
  getExternalTestDatabaseInstance,
  setupTestDatabase,
  teardownTestDatabase,
  truncateAllTables,
  clearTestDatabaseInstance,
  createTestServer,
  startTestServer,
  stopTestServer,
  createTestHttpClient,
  httpGet,
  testLogger,
} from "maxq-test-utils";
import type { PaginatedResult, Run } from "maxq";
import { mkdir, writeFile, chmod } from "fs/promises";
import { join, dirname } from "path";

// Exported state
export let testDb: TestDatabase;
export let testServer: TestServer;
export let client: TestHttpClient;
export let defaultFlowsRoot: string;

let initialized = false;

// Check for external mode
const externalTestUrl = process.env.TEST_URL;
const externalDbPath = process.env.TEST_DB_PATH;

/**
 * Wait for all active flows to complete by polling the API
 * This works across process boundaries (test process -> spawned server process)
 * Waits for both pending and running flows to reach terminal states
 */
async function waitForActiveFlows(): Promise<void> {
  const maxWait = 10000; // 10 seconds (increased for scheduler-driven execution)
  const interval = 100; // Check every 100ms (less frequent polling)
  const startTime = Date.now();
  let lastPendingCount = -1;
  let lastRunningCount = -1;

  while (Date.now() - startTime < maxWait) {
    try {
      // Check for pending runs
      const pendingResponse = await httpGet<PaginatedResult<Run>>(
        client,
        "/api/v1/runs?status=pending&limit=10",
      );

      // Check for running runs
      const runningResponse = await httpGet<PaginatedResult<Run>>(
        client,
        "/api/v1/runs?status=running&limit=10",
      );

      // Check if responses have the expected structure
      if (
        pendingResponse.status === 200 &&
        pendingResponse.data?.pagination &&
        runningResponse.status === 200 &&
        runningResponse.data?.pagination
      ) {
        const pendingCount = pendingResponse.data.pagination.total;
        const runningCount = runningResponse.data.pagination.total;

        if (
          pendingCount !== lastPendingCount ||
          runningCount !== lastRunningCount
        ) {
          testLogger.debug(
            `Active flows - pending: ${pendingCount}, running: ${runningCount}`,
          );
          lastPendingCount = pendingCount;
          lastRunningCount = runningCount;
        }

        if (pendingCount === 0 && runningCount === 0) {
          return; // No active flows
        }
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    } catch (error) {
      // Ignore errors during cleanup - server might be shutting down
      testLogger.debug("Error checking active flows:", error);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  testLogger.warn(
    `Timeout waiting for active flows to complete (last pending: ${lastPendingCount}, last running: ${lastRunningCount})`,
  );
}

/**
 * Creates dummy flows for API tests
 * These flows return minimal valid JSON to avoid "script not executable" errors
 */
async function createDummyFlows(): Promise<void> {
  try {
    testLogger.info(`Creating dummy flows in: ${defaultFlowsRoot}`);

    // Flow names used in runs.test.ts
    const flowNames = [
      "test-workflow",
      "market-analysis",
      "data-pipeline",
      "test-flow",
      "test-flow-1",
      "test-flow-2",
      "flow-1",
      "flow-2",
      "flow-3",
      "workflow-a",
      "workflow-b",
    ];

    // Minimal valid flow that exits immediately without scheduling anything
    const flowScript = `#!/bin/bash
# Exit immediately with success
# When MAXQ_COMPLETED_STAGE is empty (first call), we can choose to:
# 1. Schedule no stages (run will complete immediately)
# 2. Schedule stages with actual work
# For API tests, we do nothing to avoid scheduler complications
exit 0
`;

    for (const flowName of flowNames) {
      const flowDir = join(defaultFlowsRoot, flowName);
      await mkdir(flowDir, { recursive: true });

      const flowPath = join(flowDir, "flow.sh");
      await writeFile(flowPath, flowScript);
      await chmod(flowPath, 0o755);
    }

    testLogger.info(`Created ${flowNames.length} dummy flows for API tests`);
  } catch (error) {
    testLogger.error("Failed to create dummy flows:", error);
    throw error;
  }
}

async function setupTests(): Promise<void> {
  if (initialized) return;

  // Compute flows root
  const currentFile = new URL(import.meta.url).pathname;
  const packageRoot = join(currentFile, "../..");
  defaultFlowsRoot = join(packageRoot, "test-flows");

  // Create dummy flows for API tests
  await createDummyFlows();

  if (externalTestUrl !== undefined && externalDbPath !== undefined) {
    // External mode
    testDb = getExternalTestDatabaseInstance(externalDbPath, testLogger);
    await setupTestDatabase(testDb);

    client = createTestHttpClient(externalTestUrl);
  } else {
    // Local mode
    testDb = getTestDatabaseInstance(testLogger);
    await setupTestDatabase(testDb);

    testServer = createTestServer({
      port: 5099,
      dataDir: dirname(testDb.dbPath),
      logger: testLogger,
      flowsRoot: defaultFlowsRoot,
    });
    await startTestServer(testServer);

    client = createTestHttpClient(`http://localhost:5099`);
  }

  initialized = true;
}

async function teardownTests(): Promise<void> {
  if (!initialized) return;
  await stopTestServer(testServer);
  await teardownTestDatabase(testDb);
  initialized = false;
  clearTestDatabaseInstance();
}

function cleanupBetweenTests(): void {
  truncateAllTables(testDb);
}

export function setupGlobalHooks(): void {
  before(async function () {
    this.timeout(60000);
    await setupTests();
  });

  afterEach(async function () {
    await waitForActiveFlows();
    cleanupBetweenTests();
  });

  after(async function () {
    this.timeout(30000);
    await teardownTests();
  });
}
