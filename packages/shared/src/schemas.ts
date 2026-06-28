import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { MESSAGE_STATUSES } from "./status.js";

const MAX_BODY_LENGTH = 2000;
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

export const phoneE164 = z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .transform((raw, ctx) => {
        const parsed = parsePhoneNumberFromString(raw, "US");
        if (!parsed || !parsed.isPossible()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid phone number",
            });
            return z.NEVER;
        }
        return parsed.number;
    });

export const futureDate = z
    .union([z.string(), z.date()])
    .transform((v, ctx) => {
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime())) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
            return z.NEVER;
        }

        if (d.getTime() < Date.now() - CLOCK_SKEW_TOLERANCE_MS) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Scheduled time must be in the future",
            });
            return z.NEVER;
        }

        return d;
    });

export const scheduleMessageInput = z.object({
    recipient: phoneE164,
    body: z
        .string()
        .trim()
        .min(1, "Message cannot be empty")
        .max(MAX_BODY_LENGTH, `Message must be at most ${MAX_BODY_LENGTH} characters`),
    scheduledAt: futureDate,
});

export type ScheduleMessageInput = z.input<typeof scheduleMessageInput>;
export type ScheduleMessageParsed = z.output<typeof scheduleMessageInput>;

export const messageStatusSchema = z.enum(MESSAGE_STATUSES);

export const scheduledMessage = z.object({
    id: z.string(),
    recipient: z.string(),
    body: z.string(),
    scheduledAt: z.string(),
    status: messageStatusSchema,
    attempts: z.number(),
    lastError: z.string().nullable(),
    gatewayGuid: z.string().nullable(),
    sentAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type ScheduledMessage = z.infer<typeof scheduledMessage>;

export const statusEvent = z.object({
    id: z.string(),
    messageId: z.string(),
    status: messageStatusSchema,
    detail: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
});
export type StatusEvent = z.infer<typeof statusEvent>;

export const statusWebhookInput = z
    .object({
        gatewayGuid: z.string().optional(),
        messageId: z.string().optional(),
        status: messageStatusSchema,
        detail: z.record(z.string(), z.unknown()).optional(),
    })
    .refine((v) => v.gatewayGuid || v.messageId, {
        message: "Either gatewayGuid or messageId is required",
    });
export type StatusWebhookInput = z.infer<typeof statusWebhookInput>;