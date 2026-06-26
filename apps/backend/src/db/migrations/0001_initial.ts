import { type Kysely, sql } from "kysely";

export const migration = {
  async up(db: Kysely<unknown>): Promise<void> {
    await sql`
      CREATE TYPE message_status AS ENUM (
        'QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'RECEIVED', 'FAILED'
      )
    `.execute(db);

    await sql`
      CREATE TABLE scheduled_messages (
        id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        recipient       text NOT NULL,
        body            text NOT NULL,
        scheduled_at    timestamptz NOT NULL,
        status          message_status NOT NULL DEFAULT 'QUEUED',
        attempts        integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        last_error      text,
        gateway_guid    text,
        sent_at         timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_sched_msgs_queue
        ON scheduled_messages (scheduled_at, id)
        WHERE status = 'QUEUED'
    `.execute(db);

    await sql`
      CREATE INDEX idx_sched_msgs_gateway_guid
        ON scheduled_messages (gateway_guid)
        WHERE gateway_guid IS NOT NULL
    `.execute(db);

    await sql`
      CREATE TABLE message_status_events (
        id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        message_id bigint NOT NULL REFERENCES scheduled_messages (id) ON DELETE CASCADE,
        status     message_status NOT NULL,
        detail     jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_status_events_message
        ON message_status_events (message_id, created_at)
    `.execute(db);

    await sql`
      CREATE TABLE scheduler_state (
        id               boolean PRIMARY KEY DEFAULT true,
        last_dispatch_at timestamptz,
        CONSTRAINT scheduler_state_singleton CHECK (id)
      )
    `.execute(db);

    await sql`
      INSERT INTO scheduler_state (id, last_dispatch_at) VALUES (true, NULL)
    `.execute(db);

    await sql`
      CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `.execute(db);

    await sql`
      CREATE TRIGGER trg_sched_msgs_updated_at
        BEFORE UPDATE ON scheduled_messages
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `.execute(db);
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await sql`DROP TRIGGER IF EXISTS trg_sched_msgs_updated_at ON scheduled_messages`.execute(db);
    await sql`DROP FUNCTION IF EXISTS set_updated_at()`.execute(db);
    await sql`DROP TABLE IF EXISTS message_status_events`.execute(db);
    await sql`DROP TABLE IF EXISTS scheduler_state`.execute(db);
    await sql`DROP TABLE IF EXISTS scheduled_messages`.execute(db);
    await sql`DROP TYPE IF EXISTS message_status`.execute(db);
  },
};