import type { MessageStatus } from "./status.js";

export interface ChatDbMessageFlags {
    is_sent: number | null;
    is_delivered: number | null;
    date_delivered: number | null;
    date_read: number | null;
}

export function chatDbFlagsToStatus(
    flags: ChatDbMessageFlags,
): MessageStatus | null {
    if ((flags.date_read ?? 0) > 0) return "RECEIVED";

    if ((flags.is_delivered ?? 0) === 1 || (flags.date_delivered ?? 0) > 0) {
        return "DELIVERED";
    }

    if ((flags.is_sent ?? 0) === 1) return "SENT";

    return null;
}

export const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;

const NANOSECOND_THRESHOLD = 1e11;

export function appleDateToJsDate(appleDate: number | null): Date | null {
    if (!appleDate || appleDate <= 0) return null;

    const seconds =
        appleDate > NANOSECOND_THRESHOLD ? appleDate / 1_000_000_000 : appleDate;

    return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
}