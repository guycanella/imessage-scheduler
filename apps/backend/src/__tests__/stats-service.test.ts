import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { type Kysely, sql } from "kysely";
import { createDb } from "../db/connection.js";
import type { Database } from "../db/types.js";
import type { MessageStatus } from "@ims/shared";
import { getStats } from "../stats-service.js";

let db: Kysely<Database>;
const base = new Date();
const at = (offsetSec: number) => new Date(base.getTime() + offsetSec * 1000);

async function seedMessage(
  status: MessageStatus,
  attempts: number,
  events: Array<{ status: MessageStatus; at: Date }>,
) {
  const row = await db
    .insertInto("scheduled_messages")
    .values({
      recipient: "+15551230000",
      body: "seed",
      scheduled_at: base,
      status,
      attempts,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  for (const e of events) {
    await db
      .insertInto("message_status_events")
      .values({ message_id: row.id, status: e.status, detail: null, created_at: e.at })
      .execute();
  }
}

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
  await sql`TRUNCATE message_status_events, scheduled_messages RESTART IDENTITY CASCADE`.execute(db);

  await seedMessage("RECEIVED", 0, [
    { status: "ACCEPTED", at: at(0) },
    { status: "SENT", at: at(1) },
    { status: "DELIVERED", at: at(3) },
    { status: "RECEIVED", at: at(10) },
  ]);
  await seedMessage("DELIVERED", 1, [
    { status: "ACCEPTED", at: at(0) },
    { status: "SENT", at: at(2) },
    { status: "DELIVERED", at: at(5) },
  ]);
  await seedMessage("FAILED", 3, [
    { status: "ACCEPTED", at: at(0) },
    { status: "FAILED", at: at(1) },
  ]);
  await seedMessage("QUEUED", 0, []);
});

afterAll(async () => {
  await sql`TRUNCATE message_status_events, scheduled_messages RESTART IDENTITY CASCADE`.execute(db);
  await db.destroy();
});

describe("getStats", () => {
  it("computes total and current status breakdown", async () => {
    const s = await getStats(db);
    expect(s.total).toBe(4);
    expect(s.statusCounts.QUEUED).toBe(1);
    expect(s.statusCounts.DELIVERED).toBe(1);
    expect(s.statusCounts.RECEIVED).toBe(1);
    expect(s.statusCounts.FAILED).toBe(1);
  });

  it("computes the funnel of stages ever reached", async () => {
    const s = await getStats(db);
    expect(s.reached.ACCEPTED).toBe(3);
    expect(s.reached.SENT).toBe(2);
    expect(s.reached.DELIVERED).toBe(2);
    expect(s.reached.RECEIVED).toBe(1);
    expect(s.reached.FAILED).toBe(1);
  });

  it("computes failure rate and average attempts", async () => {
    const s = await getStats(db);
    expect(s.failureRate).toBeCloseTo(0.25, 4);
    expect(s.avgAttempts).toBeCloseTo(1, 2);
  });

  it("computes stage durations with median and p95 via CTE", async () => {
    const s = await getStats(db);
    expect(s.timing.acceptedToSent?.count).toBe(2);
    expect(s.timing.acceptedToSent?.avgSeconds).toBeCloseTo(1.5, 2);
    expect(s.timing.acceptedToSent?.p50Seconds).toBeCloseTo(1.5, 2);
    expect(s.timing.sentToDelivered?.count).toBe(2);
    expect(s.timing.sentToDelivered?.avgSeconds).toBeCloseTo(2.5, 2);
    expect(s.timing.deliveredToReceived?.count).toBe(1);
    expect(s.timing.deliveredToReceived?.avgSeconds).toBeCloseTo(7, 2);
    expect(s.timing.endToEnd?.count).toBe(1);
    expect(s.timing.endToEnd?.avgSeconds).toBeCloseTo(10, 2);
  });

  it("returns 24 hourly throughput buckets summing the SENT events", async () => {
    const s = await getStats(db);
    expect(s.throughput).toHaveLength(24);
    const totalSent = s.throughput.reduce((acc, b) => acc + b.sent, 0);
    expect(totalSent).toBe(2);
  });
});