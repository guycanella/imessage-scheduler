import { loadConfig } from "./config.js";
import { getDb } from "./db/connection.js";
import { createServer } from "./server.js";
import { createHttpGateway } from "./gateway/http-gateway.js";
import { startScheduler } from "./scheduler.js";

const config = loadConfig();
const db = getDb();
const gateway = createHttpGateway(config.GATEWAY_URL);

const app = createServer(db);
const server = app.listen(config.BACKEND_PORT, () => {
    console.log(`[backend] listening on :${config.BACKEND_PORT}`);
});

const scheduler = startScheduler(
    db,
    gateway,
    {
        sendIntervalMs: config.SEND_INTERVAL_MS,
        maxAttempts: config.MAX_ATTEMPTS,
        retryBackoffBaseMs: config.RETRY_BACKOFF_BASE_MS,
    },
    config.SCHEDULER_TICK_MS,
);

async function shutdown(): Promise<void> {
    console.log("[backend] shutting down");
    scheduler.stop();
    server.close();
    await db.destroy();
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);