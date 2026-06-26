import { type Kysely, type Transaction, sql } from "kysely";
import type { MessageStatus } from "@ims/shared";
import type {
    Database,
    ScheduledMessageRow,
    StatusEventRow,
} from "./types.js";

type Db = Kysely<Database>;
type Trx = Transaction<Database>;

export interface CreateMessageParams {
    recipient: string;
    body: string;
    scheduledAt: Date;
}

export async function insertScheduledMessage(
    db: Db,
    params: CreateMessageParams,
): Promise<ScheduledMessageRow> {
    return db.transaction().execute(async (trx) => {
        const message = await trx
            .insertInto("scheduled_messages")
            .values({
                recipient: params.recipient,
                body: params.body,
                scheduled_at: params.scheduledAt,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        await trx
            .insertInto("message_status_events")
            .values({ message_id: message.id, status: "QUEUED", detail: null })
            .execute();

        return message;
    });
}

export async function listScheduledMessages(
    db: Db,
): Promise<ScheduledMessageRow[]> {
    return db
        .selectFrom("scheduled_messages")
        .selectAll()
        .orderBy("scheduled_at")
        .orderBy("id")
        .execute();
}

export async function getMessageWithEvents(
    db: Db,
    id: string,
): Promise<{ message: ScheduledMessageRow; events: StatusEventRow[] } | null> {
    const message = await db
        .selectFrom("scheduled_messages")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

    if (!message) return null;

    const events = await db
        .selectFrom("message_status_events")
        .selectAll()
        .where("message_id", "=", id)
        .orderBy("created_at")
        .orderBy("id")
        .execute();

    return { message, events };
}

export async function findByGatewayGuid(
    db: Db,
    gatewayGuid: string,
): Promise<ScheduledMessageRow | null> {
    const row = await db
        .selectFrom("scheduled_messages")
        .selectAll()
        .where("gateway_guid", "=", gatewayGuid)
        .executeTakeFirst();
    return row ?? null;
}

export async function recordStatusEvent(
    db: Db | Trx,
    messageId: string,
    status: MessageStatus,
    detail: Record<string, unknown> | null = null,
): Promise<void> {
    await db
        .insertInto("message_status_events")
        .values({
            message_id: messageId,
            status,
            detail: detail ? JSON.stringify(detail) : null,
        })
        .execute();
}

export async function claimNextEligible(
    trx: Trx,
): Promise<ScheduledMessageRow | null> {
    const candidate = await trx
        .selectFrom("scheduled_messages")
        .selectAll()
        .where("status", "=", "QUEUED")
        .where("scheduled_at", "<=", sql<Date>`now()`)
        .where((eb) =>
            eb.or([
                eb("next_attempt_at", "is", null),
                eb("next_attempt_at", "<=", sql<Date>`now()`),
            ]),
        )
        .orderBy("scheduled_at")
        .orderBy("id")
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();

    if (!candidate) return null;

    const updated = await trx
        .updateTable("scheduled_messages")
        .set({ status: "ACCEPTED" })
        .where("id", "=", candidate.id)
        .returningAll()
        .executeTakeFirstOrThrow();

    await recordStatusEvent(trx, updated.id, "ACCEPTED");

    return updated;
}