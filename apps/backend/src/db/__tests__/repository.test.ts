import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from "vitest";
import { Migrator, type Kysely, sql } from "kysely";
import { createDb } from "../connection.js";
import { migrations } from "../migrations/index.js";
import {
    claimNextEligible,
    getMessageWithEvents,
    insertScheduledMessage,
} from "../repository.js";
import type { Database } from "../types.js";

let db: Kysely<Database>;

const inOneHour = () => new Date(Date.now() + 3_600_000);
const oneHourAgo = () => new Date(Date.now() - 3_600_000);

beforeAll(async () => {
    db = createDb(inject("databaseUrl"));
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
    });
    await migrator.migrateToLatest();
});

afterEach(async () => {
    await sql`TRUNCATE scheduled_messages, message_status_events RESTART IDENTITY CASCADE`.execute(db);
});

afterAll(async () => {
    await db.destroy();
});

describe("insertScheduledMessage", () => {
    it("creates a QUEUED message with an initial status event", async () => {
        const msg = await insertScheduledMessage(db, {
            recipient: "+15551234567",
            body: "hello",
            scheduledAt: inOneHour(),
        });

        expect(msg.status).toBe("QUEUED");
        expect(msg.attempts).toBe(0);

        const found = await getMessageWithEvents(db, msg.id);

        expect(found?.events).toHaveLength(1);
        expect(found?.events[0]?.status).toBe("QUEUED");
    });
});

describe("claimNextEligible (FIFO + FOR UPDATE SKIP LOCKED)", () => {
    it("respects FIFO order by scheduled_at then id", async () => {
        const later = await insertScheduledMessage(db, {
            recipient: "+15550000002",
            body: "second",
            scheduledAt: oneHourAgo(),
        });
        const earlier = await insertScheduledMessage(db, {
            recipient: "+15550000001",
            body: "first",
            scheduledAt: new Date(Date.now() - 7_200_000),
        });

        const claimed = await db.transaction().execute((trx) => claimNextEligible(trx));

        expect(claimed?.id).toBe(earlier.id);
        expect(claimed?.id).not.toBe(later.id);
    });

    it("never hands the same row to two concurrent claimers", async () => {
        const eligibleCount = 3;
        for (let i = 0; i < eligibleCount; i++) {
            await insertScheduledMessage(db, {
                recipient: `+1555000100${i}`,
                body: `msg ${i}`,
                scheduledAt: oneHourAgo(),
            });
        }

        const concurrentClaimers = 5;

        const results = await Promise.all(
            Array.from({ length: concurrentClaimers }).map(() =>
                db.transaction().execute(async (trx) => {
                    const row = await claimNextEligible(trx);
                    await new Promise((r) => setTimeout(r, 60));
                    return row?.id ?? null;
                }),
            ),
        );

        const claimedIds = results.filter((id): id is string => id !== null);

        expect(claimedIds).toHaveLength(eligibleCount);
        expect(new Set(claimedIds).size).toBe(eligibleCount);
    });

    it("skips messages not yet due (scheduled_at in the future)", async () => {
        await insertScheduledMessage(db, {
            recipient: "+15550000009",
            body: "future",
            scheduledAt: inOneHour(),
        });

        const claimed = await db.transaction().execute((trx) => claimNextEligible(trx));

        expect(claimed).toBeNull();
    });
});