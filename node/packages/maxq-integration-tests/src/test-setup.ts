import {
  TestDatabase,
  TestServer,
  TestHttpClient,
  testLogger,
} from "@codespin/maxq-test-utils";

// Test configuration
export const testDb = new TestDatabase({
  dbName: "maxq_test",
  logger: testLogger,
});
export const testServer = new TestServer({
  port: 5099,
  dbName: "maxq_test",
  logger: testLogger,
});
export const client = new TestHttpClient(`http://localhost:5099`);

// Setup before all tests
before(async function () {
  this.timeout(60000); // 60 seconds for setup

  testLogger.info("🚀 Starting MaxQ integration test setup...");

  // Setup database
  await testDb.setup();

  // Start the real MaxQ server
  await testServer.start();

  testLogger.info("✅ MaxQ integration test setup complete");
});

// Cleanup after each test
afterEach(async function () {
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
