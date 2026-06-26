import type { ScheduledMessage, StatusEvent } from "@ims/shared";
import type { ScheduledMessageRow, StatusEventRow } from "./db/types.js";

const iso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function toScheduledMessageDto(row: ScheduledMessageRow): ScheduledMessage {
    return {
        id: row.id,
        recipient: row.recipient,
        body: row.body,
        scheduledAt: iso(row.scheduled_at),
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error,
        gatewayGuid: row.gateway_guid,
        sentAt: row.sent_at ? iso(row.sent_at) : null,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

export function toStatusEventDto(event: StatusEventRow): StatusEvent {
    return {
        id: event.id,
        messageId: event.message_id,
        status: event.status,
        detail: event.detail,
        createdAt: iso(event.created_at),
    };
}