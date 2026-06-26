import type { MessageStatus } from "@ims/shared";

export interface StatusReporter {
    report(
        messageId: string,
        status: MessageStatus,
        detail?: Record<string, unknown>,
    ): Promise<void>;
}

export function createHttpStatusReporter(webhookUrl: string): StatusReporter {
    return {
        async report(messageId, status, detail) {
            try {
                const res = await fetch(webhookUrl, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ messageId, status, detail }),
                });
                if (!res.ok) {
                    console.error(
                        `[gateway] webhook rejected ${status} for ${messageId}: ${res.status}`,
                    );
                }
            } catch (err) {
                console.error(`[gateway] failed to report ${status} for ${messageId}`, err);
            }
        },
    };
}