import type { ScheduledMessageRow } from "../db/types.js";

export interface DispatchResult {
    gatewayGuid: string;
}

export interface MessageGateway {
    dispatch(message: ScheduledMessageRow): Promise<DispatchResult>;
}