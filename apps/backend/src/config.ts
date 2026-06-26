import "./load-env.js";
import { z } from "zod";

const envSchema = z.object({
    DATABASE_URL: z.string().url(),
    SEND_INTERVAL_MS: z.coerce.number().int().nonnegative().default(3_600_000),
    SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),
    MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    RETRY_BACKOFF_BASE_MS: z.coerce.number().int().nonnegative().default(60_000),
    BACKEND_PORT: z.coerce.number().int().positive().default(3001),
    GATEWAY_URL: z.string().url().default("http://localhost:3002"),
    BACKEND_WEBHOOK_URL: z
        .string()
        .url()
        .default("http://localhost:3001/api/webhooks/status"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n");
        throw new Error(`Invalid environment configuration:\n${issues}`);
    }

    return parsed.data;
}