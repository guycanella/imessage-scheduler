import { describe, it, expect } from "vitest";
import {
    scheduleMessageInput,
    canTransition,
    isForwardProgress,
    chatDbFlagsToStatus,
    appleDateToJsDate,
    APPLE_EPOCH_OFFSET_SECONDS,
} from "../index.js";

describe("scheduleMessageInput", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();

    it("normalizes a US phone number to E.164", () => {
        const r = scheduleMessageInput.parse({
            recipient: "(555) 123-4567",
            body: "hi",
            scheduledAt: future,
        });

        expect(r.recipient).toBe("+15551234567");
    });

    it("rejects an invalid phone number", () => {
        const r = scheduleMessageInput.safeParse({
            recipient: "123",
            body: "hi",
            scheduledAt: future,
        });

        expect(r.success).toBe(false);
    });

    it("rejects an empty body", () => {
        const r = scheduleMessageInput.safeParse({
            recipient: "(555) 123-4567",
            body: "   ",
            scheduledAt: future,
        });

        expect(r.success).toBe(false);
    });

    it("rejects a past scheduled time", () => {
        const r = scheduleMessageInput.safeParse({
            recipient: "(555) 123-4567",
            body: "hi",
            scheduledAt: new Date(Date.now() - 3_600_000).toISOString(),
        });

        expect(r.success).toBe(false);
    });
});

describe("status state machine", () => {
    it("allows the happy path", () => {
        expect(canTransition("QUEUED", "ACCEPTED")).toBe(true);
        expect(canTransition("ACCEPTED", "SENT")).toBe(true);
        expect(canTransition("SENT", "DELIVERED")).toBe(true);
        expect(canTransition("DELIVERED", "RECEIVED")).toBe(true);
    });

    it("forbids regressions and transitions out of terminal states", () => {
        expect(canTransition("DELIVERED", "SENT")).toBe(false);
        expect(canTransition("RECEIVED", "DELIVERED")).toBe(false);
        expect(canTransition("FAILED", "SENT")).toBe(false);
    });

    it("isForwardProgress prevents chat.db regressions", () => {
        expect(isForwardProgress("SENT", "DELIVERED")).toBe(true);
        expect(isForwardProgress("DELIVERED", "SENT")).toBe(false);
        expect(isForwardProgress("DELIVERED", "DELIVERED")).toBe(false);
    });
});

describe("chat.db mapping", () => {
    it("derives the furthest observable status", () => {
        expect(
            chatDbFlagsToStatus({ is_sent: 1, is_delivered: 0, date_delivered: 0, date_read: 0 }),
        ).toBe("SENT");

        expect(
            chatDbFlagsToStatus({ is_sent: 1, is_delivered: 1, date_delivered: 0, date_read: 0 }),
        ).toBe("DELIVERED");

        expect(
            chatDbFlagsToStatus({ is_sent: 1, is_delivered: 1, date_delivered: 0, date_read: 123 }),
        ).toBe("RECEIVED");

        expect(
            chatDbFlagsToStatus({ is_sent: 0, is_delivered: 0, date_delivered: 0, date_read: 0 }),
        ).toBeNull();
    });

    it("round-trips an Apple epoch (ns) timestamp to a Date", () => {
        const jsDate = new Date("2025-06-01T12:00:00.000Z");
        const appleSeconds = jsDate.getTime() / 1000 - APPLE_EPOCH_OFFSET_SECONDS;
        const appleNanos = appleSeconds * 1_000_000_000;
        const back = appleDateToJsDate(appleNanos)!;
        expect(back.getTime()).toBe(jsDate.getTime());
    });

    it("treats null/zero as an absent date", () => {
        expect(appleDateToJsDate(0)).toBeNull();
        expect(appleDateToJsDate(null)).toBeNull();
    });
});