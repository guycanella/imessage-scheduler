import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from "vitest";
import { Migrator, type Kysely, sql } from "kysely";
import { createDb } from "../db/connection.js";
import { migrations } from "../db/migrations/index.js";
import { getMessageWithEvents, insertScheduledMessage } from "../db/repository.js";
import { runTick, type SchedulerOptions } from "../scheduler.js";
import type { MessageGateway } from "../gateway/types.js";
import type { Database } from "../db/types.js";

let db: Kysely<Database>;

const successGateway: MessageGateway = {
    dispatch: async (m) => ({ gatewayGuid: `guid-${m.id}` }),
};
const failingGateway: MessageGateway = {
    dispatch: async () => {
        throw new Error("Messages.app not running");
    },
};

const opts = (over: Partial<SchedulerOptions> = {}): SchedulerOptions => ({
    sendIntervalMs: 3_600_000,
    maxAttempts: 3,
    retryBackoffBaseMs: 0,
    ...over,
});

const enqueueDue = (recipient: string) =>
    insertScheduledMessage(db, {
        recipient,
        body: "x",
        scheduledAt: new Date(Date.now() - 1000),
    });

const setLastDispatch = (expr: string) =>
    sql`UPDATE scheduler_state SET last_dispatch_at = ${sql.raw(expr)} WHERE id = true`.execute(db);

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
    await setLastDispatch("NULL");
});

afterAll(async () => {
    await db.destroy();
});

describe("runTick", () => {
    it("dispatches one message and consumes the throttle window", async () => {
        const a = await enqueueDue("+15550000001");
        await enqueueDue("+15550000002");

        const first = await runTick(db, successGateway, opts());
        expect(first.dispatched).toBe(a.id);

        const claimed = await getMessageWithEvents(db, a.id);
        expect(claimed?.message.status).toBe("ACCEPTED");
        expect(claimed?.message.gateway_guid).toBe(`guid-${a.id}`);

        const second = await runTick(db, successGateway, opts());
        expect(second.throttled).toBe(true);
        expect(second.dispatched).toBeNull();
    });

    it("dispatches again once the interval has elapsed", async () => {
        await enqueueDue("+15550000003");
        await setLastDispatch("now() - interval '2 hours'");
        const res = await runTick(db, successGateway, opts());
        expect(res.dispatched).not.toBeNull();
    });

    it("is idle when there is nothing eligible", async () => {
        const res = await runTick(db, successGateway, opts());
        expect(res).toMatchObject({ dispatched: null, throttled: false });
    });

    it("retries with backoff and fails after maxAttempts, without consuming the window", async () => {
        const m = await enqueueDue("+15550000004");

        const t1 = await runTick(db, failingGateway, opts());
        expect(t1.retried).toBe(m.id);

        const t2 = await runTick(db, failingGateway, opts());
        expect(t2.retried).toBe(m.id);

        const t3 = await runTick(db, failingGateway, opts());
        expect(t3.failed).toBe(m.id);

        const final = await getMessageWithEvents(db, m.id);

        expect(final?.message.status).toBe("FAILED");
        expect(final?.message.attempts).toBe(3);
        expect(final?.message.last_error).toContain("Messages.app");

        const windowRow = await db
            .selectFrom("scheduler_state")
            .select("last_dispatch_at")
            .where("id", "=", true)
            .executeTakeFirstOrThrow();

        expect(windowRow.last_dispatch_at).toBeNull();
    });
});