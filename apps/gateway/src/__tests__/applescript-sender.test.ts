import { describe, expect, it, vi } from "vitest";
import { createAppleScriptSender } from "../applescript-sender.js";
import type { StatusReporter } from "../status-reporter.js";
import type { MessageStatus } from "@ims/shared";

function fakeReporter() {
  const calls: Array<{ status: MessageStatus }> = [];
  const reporter: StatusReporter = {
    async report(_id, status) {
      calls.push({ status });
    },
  };
  return { reporter, calls };
}

const params = { messageId: "1", to: "+15551234567", body: "hi" };

describe("AppleScriptSender", () => {
  it("does not invoke osascript in dry-run and reports SENT", async () => {
    const { reporter, calls } = fakeReporter();
    const run = vi.fn(async () => {});
    const sender = createAppleScriptSender(reporter, { dryRun: true, allowlist: [] }, run);
    const result = await sender.send(params);
    
    expect(run).not.toHaveBeenCalled();
    expect(result.gatewayGuid).toContain("applescript-1");

    await Promise.resolve();
    expect(calls.map((c) => c.status)).toContain("SENT");
  });

  it("refuses real sending when allowlist is empty", async () => {
    const { reporter } = fakeReporter();
    const run = vi.fn(async () => {});
    const sender = createAppleScriptSender(reporter, { dryRun: false, allowlist: [] }, run);

    await expect(sender.send(params)).rejects.toThrow(/allowlist/i);
    expect(run).not.toHaveBeenCalled();
  });

  it("blocks recipients outside the allowlist", async () => {
    const { reporter } = fakeReporter();
    const run = vi.fn(async () => {});
    const sender = createAppleScriptSender(
      reporter,
      { dryRun: false, allowlist: ["+15550000000"] },
      run,
    );

    await expect(sender.send(params)).rejects.toThrow(/not in/i);
    expect(run).not.toHaveBeenCalled();
  });

  it("invokes osascript for an allowed recipient and reports SENT", async () => {
    const { reporter, calls } = fakeReporter();
    const run = vi.fn(async () => {});
    const sender = createAppleScriptSender(
      reporter,
      { dryRun: false, allowlist: ["+15551234567"] },
      run,
    );
    await sender.send(params);
    expect(run).toHaveBeenCalledWith("+15551234567", "hi");

    await Promise.resolve();
    expect(calls.map((c) => c.status)).toContain("SENT");
  });

  it("propagates an osascript failure (so the backend can retry)", async () => {
    const { reporter } = fakeReporter();
    const run = vi.fn(async () => {
      throw new Error("osascript exited with 1");
    });
    const sender = createAppleScriptSender(
      reporter,
      { dryRun: false, allowlist: ["+15551234567"] },
      run,
    );
    
    await expect(sender.send(params)).rejects.toThrow(/osascript/);
  });
});