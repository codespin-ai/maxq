import { config } from "dotenv";
config();

// Base configuration - DO NOT EXPORT DEFAULT
// Each database should have its own knexfile.js that imports this
export const baseConfig = {
  client: "postgresql",
  searchPath: ["public"],
  pool: {
    min: 2,
    max: 10,
  },
};
