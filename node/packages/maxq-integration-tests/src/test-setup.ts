import {
  TestDatabase,
  TestServer,
  TestHttpClient,
  testLogger,
} from "@codespin/maxq-test-utils";
import type { PaginatedResult, Run } from "@codespin/maxq-server";
import { use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { mkdir, writeFile, chmod } from "fs/promises";
import { join } from "path";

// Setup chai-as-promised for async assertions
use(chaiAsPromised);

// Test configuration
export const testDb = new TestDatabase({
  dbName: "maxq_test",
  logger: testLogger,
});

// Compute flows root for server - must match where we create dummy flows
// import.meta.url points to src/test-setup.ts when running with ts-node
// Go up to packages/maxq-integration-tests, then to maxq-server
const currentFile = new URL(import.meta.url).pathname;
const srcDir = join(currentFile, ".."); // src/
const packageRoot = join(srcDir, ".."); // maxq-integration-tests/
const packagesDir = join(packageRoot, ".."); // packages/
const flowsRoot = join(packagesDir, "maxq-server/flows");

export const testServer = new TestServer({
  port: 5099,
  dbName: "maxq_test",
  logger: testLogger,
  flowsRoot, // Explicitly set flows root
});
export const client = new TestHttpClient(`http://localhost:5099`);

/**
 * Wait for all active flows to complete by polling the API
 * This works across process boundaries (test process -> spawned server process)
 */
async function waitForActiveFlows(): Promise<void> {
  const maxWait = 5000; // 5 seconds
  const interval = 50; // Check every 50ms
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await client.get<PaginatedResult<Run>>(
        "/api/v1/runs?status=running&limit=1",
      );

      // Check if response has the expected structure
      if (response.status === 200 && response.data?.pagination?.total === 0) {
        return; // No active flows
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    } catch (error) {
      // Ignore errors during cleanup - server might be shutting down
      testLogger.debug("Error checking active flows:", error);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  testLogger.warn("Timeout waiting for active flows to complete");
}

/**
 * Creates dummy flows for API tests
 * These flows return minimal valid JSON to avoid "script not executable" errors
 */
async function createDummyFlows(): Promise<void> {
  try {
    testLogger.info(`Creating dummy flows in: ${flowsRoot}`);

    // Flow names used in runs.test.ts
    const flowNames = [
      "test-workflow",
      "market-analysis",
      "data-pipeline",
      "test-flow",
      "flow-1",
      "flow-2",
      "flow-3",
      "workflow-a",
      "workflow-b",
    ];

    // Minimal valid flow that uses HTTP API (as per spec)
    const flowScript = `#!/bin/bash
# Schedule a dummy stage via HTTP API
curl -s -X POST "$MAXQ_API/runs/$MAXQ_RUN_ID/steps" \
  -H "Content-Type: application/json" \
  -d '{
    "stage": "dummy",
    "final": true,
    "steps": []
  }'
`;

    for (const flowName of flowNames) {
      const flowDir = join(flowsRoot, flowName);
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

// Setup before all tests
before(async function () {
  this.timeout(60000); // 60 seconds for setup

  testLogger.info("🚀 Starting MaxQ integration test setup...");

  // Create dummy flows for API tests
  await createDummyFlows();

  // Setup database
  await testDb.setup();

  // Start the real MaxQ server
  await testServer.start();

  testLogger.info("✅ MaxQ integration test setup complete");
});

// Cleanup after each test
afterEach(async function () {
  // Wait for all active flows to complete by polling the server API
  // This works across process boundaries (test process -> spawned server)
  await waitForActiveFlows();

  // Now it's safe to truncate tables
  await testDb.truncateAllTables();
});

// Teardown after all tests
after(async function () {
  this.timeout(30000); // 30 seconds for teardown

  testLogger.info("🛑 Shutting down MaxQ integration tests...");

  // Stop server
  await testServer.stop();

  // Cleanup database
  await testDb.cleanup();

  testLogger.info("✅ MaxQ integration test teardown complete");
});
