import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://ece@127.0.0.1:55432/ece_dev";

const globalForDb = globalThis as unknown as {
  eceSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.eceSql ??
  postgres(connectionString, {
    max: 10,
    prepare: false,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.eceSql = sql;
}

export const db = drizzle(sql, { schema });
export { sql };
