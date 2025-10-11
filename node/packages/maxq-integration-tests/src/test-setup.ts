import {
  TestDatabase,
  TestServer,
  TestHttpClient,
  testLogger,
} from "@codespin/maxq-test-utils";
import { waitForAllOrchestrators } from "@codespin/maxq-server";
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

console.log(`[TEST-SETUP] Computed flows root: ${flowsRoot}`);
console.log(`[TEST-SETUP] Creating TestServer with port 5099 and flowsRoot: ${flowsRoot}`);

export const testServer = new TestServer({
  port: 5099,
  dbName: "maxq_test",
  logger: testLogger,
  flowsRoot, // Explicitly set flows root
});
export const client = new TestHttpClient(`http://localhost:5099`);

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

    // Minimal valid flow response (final stage with no steps)
    const flowScript = `#!/bin/bash
cat <<'EOF'
{
  "stage": "dummy",
  "final": true,
  "steps": []
}
EOF
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
  // Wait for all background orchestrators to complete
  // This prevents race conditions where truncate happens while orchestrator is still running
  await waitForAllOrchestrators();

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
