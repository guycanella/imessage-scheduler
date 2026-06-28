import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Kysely } from "kysely";
import { scheduleMessageInput, statusWebhookInput } from "@ims/shared";
import type { Database } from "./db/types.js";
import { applyStatusUpdate } from "./status-service.js";
import {
  getMessageWithEvents,
  insertScheduledMessage,
  listScheduledMessages,
} from "./db/repository.js";
import { toScheduledMessageDto, toStatusEventDto } from "./serializers.js";
import { getStats } from "./stats-service.js";

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const wrap =
  (handler: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

export function createServer(db: Kysely<Database>): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    "/api/messages",
    wrap(async (req, res) => {
      const parsed = scheduleMessageInput.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "validation", issues: parsed.error.issues });
        return;
      }
      const created = await insertScheduledMessage(db, {
        recipient: parsed.data.recipient,
        body: parsed.data.body,
        scheduledAt: parsed.data.scheduledAt,
      });
      
      res.status(201).json(toScheduledMessageDto(created));
    }),
  );

  app.get(
    "/api/messages",
    wrap(async (_req, res) => {
      const rows = await listScheduledMessages(db);
      res.json(rows.map(toScheduledMessageDto));
    }),
  );

  app.get(
    "/api/messages/:id",
    wrap(async (req, res) => {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: "missing id" });
        return;
      }

      const found = await getMessageWithEvents(db, id);
      if (!found) {
        res.status(404).json({ error: "message not found" });
        return;
      }

      res.json({
        ...toScheduledMessageDto(found.message),
        events: found.events.map(toStatusEventDto),
      });
    }),
  );

  app.get(
    "/api/stats",
    wrap(async (_req, res) => {
      const stats = await getStats(db);
      res.json(stats);
    }),
  );

  app.post(
    "/api/webhooks/status",
    wrap(async (req, res) => {
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
    }),
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[backend] request error:", err);
    if (res.headersSent) return;

    res.status(500).json({ error: "internal server error" });
  });

  return app;
}