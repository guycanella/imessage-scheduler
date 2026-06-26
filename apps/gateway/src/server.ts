import express, { type Express } from "express";
import { z } from "zod";
import type { MessageSender } from "./sender.js";

const sendBody = z.object({
    messageId: z.string().min(1),
    to: z.string().min(1),
    body: z.string().min(1),
});

export function createGatewayServer(sender: MessageSender): Express {
    const app = express();
    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ ok: true });
    });

    app.post("/send", async (req, res) => {
        const parsed = sendBody.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "invalid send payload" });
            return;
        }
        try {
            const result = await sender.send(parsed.data);
            res.json(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.status(502).json({ error: message });
        }
    });

    return app;
}