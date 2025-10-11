import type { IDatabase } from "pg-promise";
import type { ExecutorConfig } from "../executor/types.js";

export type DataContext = {
  db: IDatabase<unknown>;
  executor: {
    config: ExecutorConfig;
    apiUrl: string;
  };
};
