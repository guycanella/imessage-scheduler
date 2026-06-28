import type { MessageStatus } from "./status.js";

export interface DurationStats {
  count: number;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
}

export interface ThroughputBucket {
  hour: string;
  sent: number;
}

export interface MessageStats {
  total: number;
  statusCounts: Record<MessageStatus, number>;
  reached: Record<MessageStatus, number>;
  failureRate: number;
  avgAttempts: number;
  timing: {
    acceptedToSent: DurationStats | null;
    sentToDelivered: DurationStats | null;
    deliveredToReceived: DurationStats | null;
    endToEnd: DurationStats | null;
  };
  throughput: ThroughputBucket[];
}