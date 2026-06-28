import { isTerminal, type MessageStatus } from "@ims/shared";
import type { ChatDbReader } from "./chatdb-reader.js";
import type { StatusReporter } from "./status-reporter.js";

export interface WatchParams {
  messageId: string;
  recipient: string;
  body: string;
  since: Date;
}

export interface DeliveryWatcher {
  watch(params: WatchParams): void;
}

export interface WatcherOptions {
  pollMs: number;
  timeoutMs: number;
}

export function createChatDbWatcher(
  reader: ChatDbReader,
  reporter: StatusReporter,
  options: WatcherOptions,
): DeliveryWatcher {
  return {
    watch({ messageId, recipient, body, since }) {
      const startedAt = Date.now();
      let lastReported: MessageStatus | null = null;

      const timer = setInterval(() => {
        void (async () => {
          let match;
          try {
            match = reader.findOutgoing(recipient, body, since);
          } catch (err) {
            console.error(`[gateway] chat.db read failed for ${messageId}`, err);
            return;
          }

          if (match && match.status !== lastReported) {
            const detail =
              match.error !== 0
                ? { gatewayGuid: match.guid, error: `chat.db error ${match.error}` }
                : { gatewayGuid: match.guid };
            await reporter.report(messageId, match.status, detail);
            lastReported = match.status;
            if (isTerminal(match.status)) {
              clearInterval(timer);
              return;
            }
          }

          if (Date.now() - startedAt >= options.timeoutMs) {
            clearInterval(timer);
          }
        })();
      }, options.pollMs);

      if (typeof timer.unref === "function") timer.unref();
    },
  };
}