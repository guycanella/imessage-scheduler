import "../load-env.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Migrator, type Kysely, sql } from "kysely";
import { createDb } from "../db/connection.js";
import { migrations } from "../db/migrations/index.js";
import { insertScheduledMessage } from "../db/repository.js";
import { applyStatusUpdate } from "../status-service.js";
import type { Database } from "../db/types.js";

let db: Kysely<Database>;
let messageId: string;

beforeAll(async () => {
    db = createDb();
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

beforeEach(async () => {
    const msg = await insertScheduledMessage(db, {
        recipient: "+15551234567",
        body: "hi",
        scheduledAt: new Date(Date.now() - 1000),
    });

    await db
        .updateTable("scheduled_messages")
        .set({ status: "ACCEPTED", gateway_guid: "guid-123" })
        .where("id", "=", msg.id)
        .execute();
    messageId = msg.id;
});

describe("applyStatusUpdate", () => {
    it("advances status by messageId and sets sent_at on SENT", async () => {
        const res = await applyStatusUpdate(db, { messageId, status: "SENT" });

        expect(res.applied).toBe(true);

        if (res.applied) {
            expect(res.message.status).toBe("SENT");
            expect(res.message.sent_at).not.toBeNull();
        }
    });

    it("is idempotent: a non-forward update is ignored", async () => {
        await applyStatusUpdate(db, { messageId, status: "DELIVERED" });
        const back = await applyStatusUpdate(db, { messageId, status: "SENT" });

        expect(back.applied).toBe(false);

        if (!back.applied) expect(back.reason).toBe("not_forward");
    });

    it("resolves the message by gatewayGuid", async () => {
        const res = await applyStatusUpdate(db, {
            gatewayGuid: "guid-123",
            status: "DELIVERED",
        });

        expect(res.applied).toBe(true);
    });

    it("returns not_found for an unknown id", async () => {
        const res = await applyStatusUpdate(db, { messageId: "999999", status: "SENT" });

        expect(res.applied).toBe(false);

        if (!res.applied) expect(res.reason).toBe("not_found");
    });
});