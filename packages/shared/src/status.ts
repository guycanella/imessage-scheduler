export const MESSAGE_STATUSES = [
    "QUEUED",
    "ACCEPTED",
    "SENT",
    "DELIVERED",
    "RECEIVED",
    "FAILED",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<MessageStatus> = new Set([
    "RECEIVED",
    "FAILED",
]);

const ALLOWED: Record<MessageStatus, ReadonlySet<MessageStatus>> = {
    QUEUED: new Set(["ACCEPTED", "FAILED"]),
    ACCEPTED: new Set(["SENT", "FAILED"]),
    SENT: new Set(["DELIVERED", "RECEIVED", "FAILED"]),
    DELIVERED: new Set(["RECEIVED", "FAILED"]),
    RECEIVED: new Set(),
    FAILED: new Set(),
};

const RANK: Record<MessageStatus, number> = {
    QUEUED: 0,
    ACCEPTED: 1,
    SENT: 2,
    DELIVERED: 3,
    RECEIVED: 4,
    FAILED: -1,
};

export function isTerminal(status: MessageStatus): boolean {
    return TERMINAL_STATUSES.has(status);
}

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
    return ALLOWED[from].has(to);
}

export function isForwardProgress(
    current: MessageStatus,
    observed: MessageStatus,
): boolean {
    if (observed === "FAILED") return current !== "FAILED";
    if (RANK[current] < 0) return false;

    return RANK[observed] > RANK[current];
}