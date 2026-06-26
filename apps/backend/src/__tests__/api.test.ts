import "../load-env.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Migrator, type Kysely, sql } from "kysely";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb } from "../db/connection.js";
import { migrations } from "../db/migrations/index.js";
import { createServer } from "../server.js";
import type { ScheduledMessage, StatusEvent } from "@ims/shared";
import type { Database } from "../db/types.js";

let db: Kysely<Database>;
let server: Server;
let baseUrl: string;

const api = (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, init);

const postJson = (path: string, body: unknown) =>
    api(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });

beforeAll(async () => {
    db = createDb();
    const migrator = new Migrator({
        db,
        provider: { getMigrations: async () => migrations },
    });
    await migrator.migrateToLatest();

    server = await new Promise<Server>((resolve) => {
        const s = createServer(db).listen(0, () => resolve(s));
    });

    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
    await sql`TRUNCATE scheduled_messages, message_status_events RESTART IDENTITY CASCADE`.execute(db);
});

afterAll(async () => {
    server.close();
    await db.destroy();
});

describe("POST /api/messages", () => {
    it("creates a QUEUED message and normalizes the phone to E.164", async () => {
        const res = await postJson("/api/messages", {
            recipient: "(555) 123-4567",
            body: "hello there",
            scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        });
        expect(res.status).toBe(201);

        const dto = (await res.json()) as ScheduledMessage;
        expect(dto.recipient).toBe("+15551234567");
        expect(dto.status).toBe("QUEUED");
        expect(dto.attempts).toBe(0);
    });

    it("rejects an invalid payload with 400", async () => {
        const res = await postJson("/api/messages", {
            recipient: "123",
            body: "",
            scheduledAt: "not-a-date",
        });

        expect(res.status).toBe(400);
    });
});

describe("GET /api/messages", () => {
    it("lists messages in FIFO order", async () => {
        await postJson("/api/messages", {
            recipient: "+15550000001",
            body: "first",
            scheduledAt: new Date(Date.now() + 1_000_000).toISOString(),
        });
        await postJson("/api/messages", {
            recipient: "+15550000002",
            body: "second",
            scheduledAt: new Date(Date.now() + 2_000_000).toISOString(),
        });

        const res = await api("/api/messages");
        expect(res.status).toBe(200);

        const list = (await res.json()) as ScheduledMessage[];
        expect(list).toHaveLength(2);
        expect(list[0]?.body).toBe("first");
    });
});

describe("GET /api/messages/:id", () => {
    it("returns the message with its status events", async () => {
        const created = (await (
            await postJson("/api/messages", {
                recipient: "+15550000003",
                body: "detail",
                scheduledAt: new Date(Date.now() + 1_000_000).toISOString(),
            })
        ).json()) as ScheduledMessage;

        const res = await api(`/api/messages/${created.id}`);
        expect(res.status).toBe(200);

        const detail = (await res.json()) as ScheduledMessage & { events: StatusEvent[] };
        expect(detail.id).toBe(created.id);
        expect(detail.events).toHaveLength(1);
        expect(detail.events[0]?.status).toBe("QUEUED");
    });

    it("returns 404 for an unknown id", async () => {
        const res = await api("/api/messages/999999");

        expect(res.status).toBe(404);
    });
});