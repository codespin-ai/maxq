import { baseConfig } from "../../knexfile.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  ...baseConfig,
  connection: {
    host: process.env.MAXQ_DB_HOST || "localhost",
    port: parseInt(process.env.MAXQ_DB_PORT || "5432"),
    database: process.env.MAXQ_DB_NAME || "maxq",
    user: process.env.MAXQ_DB_USER || "postgres",
    password: process.env.MAXQ_DB_PASSWORD || "postgres",
  },
  migrations: {
    directory: join(__dirname, "migrations"),
    extension: "js",
    loadExtensions: [".js"],
  },
  seeds: {
    directory: join(__dirname, "seeds"),
    extension: "js",
    loadExtensions: [".js"],
  },
};
