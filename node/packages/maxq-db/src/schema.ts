/**
 * Database schema definition using Tinqer
 */

import { createSchema } from "@webpods/tinqer";
import type { DatabaseSchema } from "./types.js";

// Export schema instance for use in domain functions
export const schema = createSchema<DatabaseSchema>();
