import { type Kysely, sql } from "kysely";
import type {
  DurationStats,
  MessageStats,
  MessageStatus,
  ThroughputBucket,
} from "@ims/shared";
import type { Database } from "./db/types.js";

interface CountsRow {
  total: number;
  queued: number;
  accepted: number;
  sent: number;
  delivered: number;
  received: number;
  failed: number;
  avg_attempts: number;
}

interface ReachedRow {
  accepted: number;
  sent: number;
  delivered: number;
  received: number;
  failed: number;
}

interface TimingRow {
  ats_n: number; ats_avg: number | null; ats_p50: number | null; ats_p95: number | null;
  std_n: number; std_avg: number | null; std_p50: number | null; std_p95: number | null;
  dtr_n: number; dtr_avg: number | null; dtr_p50: number | null; dtr_p95: number | null;
  e2e_n: number; e2e_avg: number | null; e2e_p50: number | null; e2e_p95: number | null;
}

interface ThroughputRow {
  hour: Date;
  sent: number;
}

const num = (v: unknown): number =>
  v === null || v === undefined ? 0 : Number(v);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round = (v: number, p = 3): number => Number(v.toFixed(p));

function duration(
  n: unknown,
  avg: unknown,
  p50: unknown,
  p95: unknown,
): DurationStats | null {
  const count = num(n);
  const a = numOrNull(avg);
  if (count === 0 || a === null) return null;
  return {
    count,
    avgSeconds: round(a),
    p50Seconds: round(num(p50)),
    p95Seconds: round(num(p95)),
  };
}

export async function getStats(db: Kysely<Database>): Promise<MessageStats> {
  const counts = await sql<CountsRow>`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'QUEUED')::int    AS queued,
      count(*) FILTER (WHERE status = 'ACCEPTED')::int  AS accepted,
      count(*) FILTER (WHERE status = 'SENT')::int      AS sent,
      count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
      count(*) FILTER (WHERE status = 'RECEIVED')::int  AS received,
      count(*) FILTER (WHERE status = 'FAILED')::int    AS failed,
      coalesce(avg(attempts), 0)::float                 AS avg_attempts
    FROM scheduled_messages
  `.execute(db);

  const reached = await sql<ReachedRow>`
    SELECT
      count(DISTINCT message_id) FILTER (WHERE status = 'ACCEPTED')::int  AS accepted,
      count(DISTINCT message_id) FILTER (WHERE status = 'SENT')::int      AS sent,
      count(DISTINCT message_id) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
      count(DISTINCT message_id) FILTER (WHERE status = 'RECEIVED')::int  AS received,
      count(DISTINCT message_id) FILTER (WHERE status = 'FAILED')::int    AS failed
    FROM message_status_events
  `.execute(db);

  const timing = await sql<TimingRow>`
    WITH per_message AS (
      SELECT
        message_id,
        min(created_at) FILTER (WHERE status = 'ACCEPTED')  AS accepted_at,
        min(created_at) FILTER (WHERE status = 'SENT')      AS sent_at,
        min(created_at) FILTER (WHERE status = 'DELIVERED') AS delivered_at,
        min(created_at) FILTER (WHERE status = 'RECEIVED')  AS received_at
      FROM message_status_events
      GROUP BY message_id
    ),
    durations AS (
      SELECT
        EXTRACT(EPOCH FROM (sent_at - accepted_at))       AS accepted_to_sent,
        EXTRACT(EPOCH FROM (delivered_at - sent_at))      AS sent_to_delivered,
        EXTRACT(EPOCH FROM (received_at - delivered_at))  AS delivered_to_received,
        EXTRACT(EPOCH FROM (received_at - accepted_at))   AS end_to_end
      FROM per_message
    )
    SELECT
      count(accepted_to_sent)::int AS ats_n,
      avg(accepted_to_sent) AS ats_avg,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY accepted_to_sent) AS ats_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY accepted_to_sent) AS ats_p95,
      count(sent_to_delivered)::int AS std_n,
      avg(sent_to_delivered) AS std_avg,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY sent_to_delivered) AS std_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY sent_to_delivered) AS std_p95,
      count(delivered_to_received)::int AS dtr_n,
      avg(delivered_to_received) AS dtr_avg,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY delivered_to_received) AS dtr_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY delivered_to_received) AS dtr_p95,
      count(end_to_end)::int AS e2e_n,
      avg(end_to_end) AS e2e_avg,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY end_to_end) AS e2e_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY end_to_end) AS e2e_p95
    FROM durations
  `.execute(db);

  const throughput = await sql<ThroughputRow>`
    WITH hours AS (
      SELECT generate_series(
        date_trunc('hour', now()) - interval '23 hours',
        date_trunc('hour', now()),
        interval '1 hour'
      ) AS hour
    )
    SELECT h.hour AS hour, count(e.message_id)::int AS sent
    FROM hours h
    LEFT JOIN message_status_events e
      ON e.status = 'SENT' AND date_trunc('hour', e.created_at) = h.hour
    GROUP BY h.hour
    ORDER BY h.hour
  `.execute(db);

  const c = counts.rows[0]!;
  const r = reached.rows[0]!;
  const t = timing.rows[0]!;

  const statusCounts: Record<MessageStatus, number> = {
    QUEUED: num(c.queued),
    ACCEPTED: num(c.accepted),
    SENT: num(c.sent),
    DELIVERED: num(c.delivered),
    RECEIVED: num(c.received),
    FAILED: num(c.failed),
  };

  const total = num(c.total);

  return {
    total,
    statusCounts,
    reached: {
      QUEUED: total,
      ACCEPTED: num(r.accepted),
      SENT: num(r.sent),
      DELIVERED: num(r.delivered),
      RECEIVED: num(r.received),
      FAILED: num(r.failed),
    },
    failureRate: total > 0 ? round(num(c.failed) / total, 4) : 0,
    avgAttempts: round(num(c.avg_attempts), 2),
    timing: {
      acceptedToSent: duration(t.ats_n, t.ats_avg, t.ats_p50, t.ats_p95),
      sentToDelivered: duration(t.std_n, t.std_avg, t.std_p50, t.std_p95),
      deliveredToReceived: duration(t.dtr_n, t.dtr_avg, t.dtr_p50, t.dtr_p95),
      endToEnd: duration(t.e2e_n, t.e2e_avg, t.e2e_p50, t.e2e_p95),
    },
    throughput: throughput.rows.map(
      (row): ThroughputBucket => ({
        hour: new Date(row.hour).toISOString(),
        sent: num(row.sent),
      }),
    ),
  };
}