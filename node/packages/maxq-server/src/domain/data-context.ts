import type { Database } from "better-sqlite3";
import type { ExecutorConfig } from "../executor/types.js";
import type { StepProcessRegistry } from "../executor/process-registry.js";

export type DataContext = {
  db: Database;
  executor: {
    config: ExecutorConfig;
    apiUrl: string;
    processRegistry: StepProcessRegistry;
  };
};
