import type { MessageSender } from "./sender.js";
import type { StatusReporter } from "./status-reporter.js";

export interface SimulatorDelays {
    sentMs: number;
    deliveredMs: number;
    receivedMs: number;
}

const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function createSimulatorSender(
    reporter: StatusReporter,
    delays: SimulatorDelays,
): MessageSender {
    return {
        async send({ messageId }) {
            const gatewayGuid = `sim-${messageId}-${Date.now()}`;

            void (async () => {
                await sleep(delays.sentMs);
                await reporter.report(messageId, "SENT", { gatewayGuid });
                await sleep(delays.deliveredMs - delays.sentMs);
                await reporter.report(messageId, "DELIVERED");
                await sleep(delays.receivedMs - delays.deliveredMs);
                await reporter.report(messageId, "RECEIVED");
            })();

            return { gatewayGuid };
        },
    };
}