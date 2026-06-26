import type { MessageGateway } from "./types.js";

export function createHttpGateway(gatewayUrl: string): MessageGateway {
    return {
        async dispatch(message) {
            const res = await fetch(`${gatewayUrl}/send`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    messageId: message.id,
                    to: message.recipient,
                    body: message.body,
                }),
            });

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(`gateway responded ${res.status}: ${text}`);
            }

            const data = (await res.json()) as { gatewayGuid?: unknown };
            if (typeof data.gatewayGuid !== "string") {
                throw new Error("gateway response missing gatewayGuid");
            }

            return { gatewayGuid: data.gatewayGuid };
        },
    };
}
