import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatDbWatcher } from "../delivery-watcher.js";
import type { ChatDbReader, OutgoingMatch } from "../chatdb-reader.js";
import type { StatusReporter } from "../status-reporter.js";
import type { MessageStatus } from "@ims/shared";

function setup(sequence: Array<OutgoingMatch | null>) {
  const findOutgoing = vi.fn<ChatDbReader["findOutgoing"]>();
  for (const item of sequence) findOutgoing.mockReturnValueOnce(item);
  findOutgoing.mockReturnValue(sequence[sequence.length - 1] ?? null);
  const reader: ChatDbReader = { findOutgoing, close: vi.fn() };

  const reported: Array<{ status: MessageStatus; detail?: Record<string, unknown> }> = [];
  const reporter: StatusReporter = {
    async report(_id, status, detail) {
      reported.push({ status, detail });
    },
  };
  return { reader, reporter, reported, findOutgoing };
}

const m = (status: MessageStatus, error = 0): OutgoingMatch => ({
  guid: "g",
  status,
  error,
  at: new Date(),
});

const params = { messageId: "1", recipient: "+1", body: "x", since: new Date(0) };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("chat.db delivery watcher", () => {
  it("reports forward progress and stops at a terminal status", async () => {
    const { reader, reporter, reported, findOutgoing } = setup([
      null,
      m("DELIVERED"),
      m("RECEIVED"),
    ]);
    const watcher = createChatDbWatcher(reader, reporter, { pollMs: 1000, timeoutMs: 60_000 });
    watcher.watch(params);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const callsAtTerminal = findOutgoing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);

    expect(reported.map((r) => r.status)).toEqual(["DELIVERED", "RECEIVED"]);
    expect(findOutgoing.mock.calls.length).toBe(callsAtTerminal);
  });

  it("reports FAILED (with the error detail) and stops", async () => {
    const { reader, reporter, reported } = setup([m("FAILED", 22)]);
    const watcher = createChatDbWatcher(reader, reporter, { pollMs: 1000, timeoutMs: 60_000 });
    watcher.watch(params);

    await vi.advanceTimersByTimeAsync(1000);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.status).toBe("FAILED");
    expect(reported[0]?.detail?.error).toContain("22");
  });

  it("does not re-report an unchanged status", async () => {
    const { reader, reporter, reported } = setup([m("DELIVERED"), m("DELIVERED")]);
    const watcher = createChatDbWatcher(reader, reporter, { pollMs: 1000, timeoutMs: 60_000 });
    watcher.watch(params);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(reported.map((r) => r.status)).toEqual(["DELIVERED"]);
  });

  it("stops polling after the timeout when nothing is found", async () => {
    const { reader, reporter, reported, findOutgoing } = setup([null]);
    const watcher = createChatDbWatcher(reader, reporter, { pollMs: 1000, timeoutMs: 3000 });
    watcher.watch(params);

    await vi.advanceTimersByTimeAsync(3000);
    const callsAtTimeout = findOutgoing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);

    expect(reported).toHaveLength(0);
    expect(findOutgoing.mock.calls.length).toBe(callsAtTimeout);
  });
});