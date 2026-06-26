import "../load-env.js";
import { Migrator, type MigrationResultSet } from "kysely";
import { createDb } from "./connection.js";
import { migrations } from "./migrations/index.js";

type Direction = "latest" | "down" | "reset";

function report(label: string, { error, results }: MigrationResultSet): void {
    for (const r of results ?? []) {
        if (r.status === "Success") {
            console.log(`  ${label} ok: ${r.migrationName}`);
        } else if (r.status === "Error") {
            console.error(`  ${label} failed: ${r.migrationName}`);
        }
    }
    if (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

async function run(): Promise<void> {
    const direction = (process.argv[2] ?? "latest") as Direction;
    const db = createDb();
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
    });

    try {
        if (direction === "down") {
            report("down", await migrator.migrateDown());
        } else if (direction === "reset") {
            let result = await migrator.migrateDown();
            while ((result.results ?? []).length > 0 && !result.error) {
                report("down", result);
                result = await migrator.migrateDown();
            }
            report("latest", await migrator.migrateToLatest());
        } else {
            report("latest", await migrator.migrateToLatest());
        }
    } finally {
        await db.destroy();
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});