import { type Kysely, sql } from "kysely";
import { type MessageStatus, isForwardProgress } from "@ims/shared";
import type { Database, ScheduledMessageRow } from "./db/types.js";
import { recordStatusEvent } from "./db/repository.js";

export interface StatusUpdate {
    messageId?: string;
    gatewayGuid?: string;
    status: MessageStatus;
    detail?: Record<string, unknown> | null;
}

export type ApplyResult =
    | { applied: true; message: ScheduledMessageRow }
    | { applied: false; reason: "not_found" | "not_forward" };

export async function applyStatusUpdate(
    db: Kysely<Database>,
    update: StatusUpdate,
): Promise<ApplyResult> {
    return db.transaction().execute(async (trx) => {
        let query = trx.selectFrom("scheduled_messages").selectAll();

        if (update.messageId) {
            query = query.where("id", "=", update.messageId);
        } else if (update.gatewayGuid) {
            query = query.where("gateway_guid", "=", update.gatewayGuid);
        } else {
            return { applied: false, reason: "not_found" };
        }

        const message = await query.forUpdate().executeTakeFirst();

        if (!message) {
            return { applied: false, reason: "not_found" };
        }

        if (!isForwardProgress(message.status, update.status)) {
            return { applied: false, reason: "not_forward" };
        }

        const updated = await trx
            .updateTable("scheduled_messages")
            .set({
                status: update.status,
                ...(update.status === "SENT" ? { sent_at: sql<Date>`now()` } : {}),
            })
            .where("id", "=", message.id)
            .returningAll()
            .executeTakeFirstOrThrow();

        await recordStatusEvent(trx, message.id, update.status, update.detail ?? null);

        return { applied: true, message: updated };
    });
}