import "../load-env.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Migrator, type Kysely, sql } from "kysely";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb } from "../db/connection.js";
import { migrations } from "../db/migrations/index.js";
import { getMessageWithEvents, insertScheduledMessage } from "../db/repository.js";
import { createServer } from "../server.js";
import { createHttpGateway } from "../gateway/http-gateway.js";
import { runTick } from "../scheduler.js";
import type { Database } from "../db/types.js";

let db: Kysely<Database>;
let backendServer: Server;
let gatewayServer: Server;
let backendUrl: string;
let gatewayUrl: string;

const listen = (app: express.Express): Promise<Server> =>
    new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });

const urlOf = (server: Server): string =>
    `http://localhost:${(server.address() as AddressInfo).port}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
    db = createDb();
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
    });
    await migrator.migrateToLatest();

    backendServer = await listen(createServer(db));
    backendUrl = urlOf(backendServer);
    const webhookUrl = `${backendUrl}/api/webhooks/status`;

    const stub = express();
    stub.use(express.json());
    stub.post("/send", (req, res) => {
        const { messageId } = req.body as { messageId: string };
        const gatewayGuid = `stub-${messageId}`;
        const post = (status: string) =>
            fetch(webhookUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ messageId, status }),
            }).catch(() => undefined);
        void (async () => {
            await sleep(15);
            await post("SENT");
            await sleep(15);
            await post("DELIVERED");
            await sleep(15);
            await post("RECEIVED");
        })();
        res.json({ gatewayGuid });
    });
    gatewayServer = await listen(stub);
    gatewayUrl = urlOf(gatewayServer);
});

afterEach(async () => {
    await sql`TRUNCATE scheduled_messages, message_status_events RESTART IDENTITY CASCADE`.execute(db);
    await sql`UPDATE scheduler_state SET last_dispatch_at = NULL WHERE id = true`.execute(db);
});

afterAll(async () => {
    backendServer.close();
    gatewayServer.close();
    await db.destroy();
});

describe("end-to-end status flow (scheduler -> gateway -> webhook)", () => {
    it("drives a message from QUEUED to RECEIVED", async () => {
        const gateway = createHttpGateway(gatewayUrl);
        const msg = await insertScheduledMessage(db, {
            recipient: "+15551234567",
            body: "hello",
            scheduledAt: new Date(Date.now() - 1000),
        });

        const tick = await runTick(db, gateway, {
            sendIntervalMs: 3_600_000,
            maxAttempts: 3,
            retryBackoffBaseMs: 0,
        });

        expect(tick.dispatched).toBe(msg.id);

        let status = "";
        for (let i = 0; i < 40; i++) {
            const current = await getMessageWithEvents(db, msg.id);
            status = current?.message.status ?? "";

            if (status === "RECEIVED") break;

            await sleep(25);
        }


        expect(status).toBe("RECEIVED");

        const final = await getMessageWithEvents(db, msg.id);
        const statuses = final?.events.map((e) => e.status) ?? [];

        const order = ["QUEUED", "ACCEPTED", "SENT", "DELIVERED", "RECEIVED"];
        let lastRank = -1;
        for (const s of statuses) {
            const rank = order.indexOf(s);
            expect(rank).toBeGreaterThan(lastRank);
            lastRank = rank;
        }

        expect(statuses.at(-1)).toBe("RECEIVED");
    });
});