import type { IDatabase } from "pg-promise";

export type DataContext = {
  db: IDatabase<unknown>;
};
