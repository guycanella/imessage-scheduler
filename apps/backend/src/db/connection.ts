import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./types.js";

const { Pool } = pg;

export function createDb(
    connectionString = process.env.DATABASE_URL,
): Kysely<Database> {
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }
    return new Kysely<Database>({
        dialect: new PostgresDialect({
            pool: new Pool({ connectionString }),
        }),
    });
}

let singleton: Kysely<Database> | undefined;

export function getDb(): Kysely<Database> {
    if (!singleton) {
        singleton = createDb();
    }
    return singleton;
}