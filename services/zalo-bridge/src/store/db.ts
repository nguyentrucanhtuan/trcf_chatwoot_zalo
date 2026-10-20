import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "../config.js";
import * as schema from "./schema.js";

export const sql = postgres(config.DATABASE_URL, { onnotice: () => {} });
export const db = drizzle(sql, { schema });

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function migrateDb(): Promise<void> {
  await migrate(db, { migrationsFolder });
}
