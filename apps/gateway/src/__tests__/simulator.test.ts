import { describe, expect, it } from "vitest";
import { createSimulatorSender } from "../simulator.js";
import type { StatusReporter } from "../status-reporter.js";
import type { MessageStatus } from "@ims/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SimulatorSender", () => {
    it("returns a gateway guid and reports SENT -> DELIVERED -> RECEIVED in order", async () => {
        const reported: MessageStatus[] = [];
        const reporter: StatusReporter = {
            report: async (_id, status) => {
                reported.push(status);
            },
        };

        const sender = createSimulatorSender(reporter, {
            sentMs: 10,
            deliveredMs: 25,
            receivedMs: 40,
        });

        const { gatewayGuid } = await sender.send({
            messageId: "42",
            to: "+15551234567",
            body: "hello",
        });
        expect(gatewayGuid).toMatch(/^sim-42-/);

        await sleep(80);
        expect(reported).toEqual(["SENT", "DELIVERED", "RECEIVED"]);
    });
});