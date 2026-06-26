import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, "../../../.env") });

const envSchema = z.object({
    GATEWAY_PORT: z.coerce.number().int().positive().default(3002),
    BACKEND_WEBHOOK_URL: z
        .string()
        .url()
        .default("http://localhost:3001/api/webhooks/status"),
    SIMULATOR_SENT_MS: z.coerce.number().int().nonnegative().default(1000),
    SIMULATOR_DELIVERED_MS: z.coerce.number().int().nonnegative().default(3000),
    SIMULATOR_RECEIVED_MS: z.coerce.number().int().nonnegative().default(6000),
});

export type GatewayConfig = z.infer<typeof envSchema>;

export function loadConfig(): GatewayConfig {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
            .join("\n");
        throw new Error(`Invalid gateway configuration:\n${issues}`);
    }

    return parsed.data;
}