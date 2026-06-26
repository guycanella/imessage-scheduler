import { type Kysely, sql } from "kysely";
import type { Database } from "./db/types.js";
import { claimNextEligible, recordStatusEvent } from "./db/repository.js";
import type { MessageGateway } from "./gateway/types.js";

export interface SchedulerOptions {
    sendIntervalMs: number;
    maxAttempts: number;
    retryBackoffBaseMs: number;
}

export interface TickResult {
    throttled: boolean;
    dispatched: string | null;
    retried: string | null;
    failed: string | null;
}

const idle = (): TickResult => ({
    throttled: false,
    dispatched: null,
    retried: null,
    failed: null,
});

export async function runTick(
    db: Kysely<Database>,
    gateway: MessageGateway,
    opts: SchedulerOptions,
): Promise<TickResult> {
    const intervalLiteral = `${opts.sendIntervalMs} milliseconds`;

    const outcome = await db.transaction().execute(async (trx) => {
        const state = await trx
            .selectFrom("scheduler_state")
            .select(
                sql<boolean>`(
          last_dispatch_at is null
          or now() >= last_dispatch_at + ${intervalLiteral}::interval
        )`.as("throttleOpen"),
            )
            .where("id", "=", true)
            .forUpdate()
            .executeTakeFirstOrThrow();

        if (!state.throttleOpen) {
            return { kind: "throttled" as const };
        }

        const message = await claimNextEligible(trx);
        if (!message) {
            return { kind: "idle" as const };
        }

        return { kind: "claimed" as const, message };
    });

    if (outcome.kind === "throttled") {
        return { ...idle(), throttled: true };
    }

    if (outcome.kind === "idle") {
        return idle();
    }

    const message = outcome.message;

    try {
        const { gatewayGuid } = await gateway.dispatch(message);
        await db.transaction().execute(async (trx) => {
            await trx
                .updateTable("scheduled_messages")
                .set({ gateway_guid: gatewayGuid })
                .where("id", "=", message.id)
                .execute();
            await trx
                .updateTable("scheduler_state")
                .set({ last_dispatch_at: sql<Date>`now()` })
                .where("id", "=", true)
                .execute();
        });
        return { ...idle(), dispatched: message.id };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const attempts = message.attempts + 1;

        return db.transaction().execute(async (trx) => {
            if (attempts >= opts.maxAttempts) {
                await trx
                    .updateTable("scheduled_messages")
                    .set({ status: "FAILED", attempts, last_error: errorMessage })
                    .where("id", "=", message.id)
                    .execute();

                await recordStatusEvent(trx, message.id, "FAILED", {
                    error: errorMessage,
                    attempts,
                });

                return { ...idle(), failed: message.id };
            }

            const backoffMs = opts.retryBackoffBaseMs * 2 ** (attempts - 1);

            await trx
                .updateTable("scheduled_messages")
                .set({
                    status: "QUEUED",
                    attempts,
                    last_error: errorMessage,
                    next_attempt_at: sql<Date>`now() + ${`${backoffMs} milliseconds`}::interval`,
                })
                .where("id", "=", message.id)
                .execute();

            await recordStatusEvent(trx, message.id, "QUEUED", {
                retry: attempts,
                error: errorMessage,
            });

            return { ...idle(), retried: message.id };
        });
    }
}

export interface SchedulerHandle {
    stop(): void;
}

export function startScheduler(
    db: Kysely<Database>,
    gateway: MessageGateway,
    opts: SchedulerOptions,
    tickMs: number,
): SchedulerHandle {
    let inFlight = false;

    const timer = setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        runTick(db, gateway, opts)
            .catch((err) => {
                console.error("[scheduler] tick failed", err);
            })
            .finally(() => {
                inFlight = false;
            });
    }, tickMs);

    return {
        stop: () => clearInterval(timer),
    };
}