/**
 * MaxQ server implementation
 *
 * Note: The main server is implemented in index.ts
 * This file is kept for backwards compatibility
 */

import { createLogger } from "@codespin/maxq-logger";
import type { ServerConfig } from "./types.js";

const logger = createLogger("maxq:server");

export async function startServer(config: ServerConfig): Promise<void> {
  logger.info("MaxQ server configuration", config);
  logger.info(
    "Please use npm start or run node dist/index.js to start the server",
  );
}
