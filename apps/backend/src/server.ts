import express, { type Express } from "express";
import type { Kysely } from "kysely";
import { statusWebhookInput } from "@ims/shared";
import type { Database } from "./db/types.js";
import { applyStatusUpdate } from "./status-service.js";

export function createServer(db: Kysely<Database>): Express {
    const app = express();
    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ ok: true });
    });

    app.post("/api/webhooks/status", async (req, res) => {
        const parsed = statusWebhookInput.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "invalid status payload" });
            return;
        }

        const result = await applyStatusUpdate(db, {
            messageId: parsed.data.messageId,
            gatewayGuid: parsed.data.gatewayGuid,
            status: parsed.data.status,
            detail: parsed.data.detail ?? null,
        });

        if (!result.applied && result.reason === "not_found") {
            res.status(404).json({ error: "message not found" });
            return;
        }
        res.json({ applied: result.applied });
    });

    return app;
}