/**
 * Testing helper utilities for MaxQ
 */

export type { TestDatabase } from "./utils/test-db.js";
export {
  createTestDatabase,
  setupTestDatabase,
  truncateAllTables,
  teardownTestDatabase,
  getTestDatabaseInstance,
  getExternalTestDatabaseInstance,
  clearTestDatabaseInstance,
  insertStage,
  insertStep,
  waitForQuery,
  waitForSql,
} from "./utils/test-db.js";

export type { TestServer } from "./utils/server.js";
export {
  createTestServer,
  startTestServer,
  stopTestServer,
  reconfigureTestServer,
} from "./utils/server.js";

export type { TestHttpClient, HttpResponse } from "./utils/http-client.js";
export {
  createTestHttpClient,
  httpGet,
  httpPost,
  httpPut,
  httpPatch,
  httpDelete,
  httpRequest,
  setClientApiKey,
  setClientAuthHeader,
  removeClientHeader,
} from "./utils/http-client.js";

export { testLogger, consoleLogger } from "./utils/test-logger.js";
export type { Logger } from "./utils/test-logger.js";
