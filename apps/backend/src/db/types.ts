import type {
    ColumnType,
    Generated,
    Insertable,
    Selectable,
    Updateable,
} from "kysely";
import type { MessageStatus } from "@ims/shared";

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface ScheduledMessagesTable {
    id: Generated<string>;
    recipient: string;
    body: string;
    scheduled_at: Timestamp;
    status: ColumnType<MessageStatus, MessageStatus | undefined, MessageStatus>;
    attempts: ColumnType<number, number | undefined, number>;
    next_attempt_at: Timestamp | null;
    last_error: string | null;
    gateway_guid: string | null;
    sent_at: Timestamp | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
}

export interface MessageStatusEventsTable {
    id: Generated<string>;
    message_id: string;
    status: MessageStatus;
    detail: ColumnType<Record<string, unknown> | null, string | null, string | null>;
    created_at: Generated<Date>;
}

export interface SchedulerStateTable {
    id: Generated<boolean>;
    last_dispatch_at: Timestamp | null;
}

export interface Database {
    scheduled_messages: ScheduledMessagesTable;
    message_status_events: MessageStatusEventsTable;
    scheduler_state: SchedulerStateTable;
}

export type ScheduledMessageRow = Selectable<ScheduledMessagesTable>;
export type NewScheduledMessage = Insertable<ScheduledMessagesTable>;
export type ScheduledMessageUpdate = Updateable<ScheduledMessagesTable>;

export type StatusEventRow = Selectable<MessageStatusEventsTable>;
export type NewStatusEvent = Insertable<MessageStatusEventsTable>;