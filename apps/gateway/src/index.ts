import { loadConfig } from "./config.js";
import { createHttpStatusReporter } from "./status-reporter.js";
import { createSimulatorSender } from "./simulator.js";
import { createAppleScriptSender } from "./applescript-sender.js";
import { createChatDbReader } from "./chatdb-reader.js";
import { createChatDbWatcher } from "./delivery-watcher.js";
import { createGatewayServer } from "./server.js";
import type { MessageSender } from "./sender.js";
import type { DeliveryWatcher } from "./delivery-watcher.js";

const config = loadConfig();
const reporter = createHttpStatusReporter(config.BACKEND_WEBHOOK_URL);

let sender: MessageSender;
let label: string;

if (config.GATEWAY_SENDER === "applescript") {
  let watcher: DeliveryWatcher | undefined;
  if (!config.IMESSAGE_DRY_RUN) {
    const reader = createChatDbReader(config.CHATDB_PATH);
    watcher = createChatDbWatcher(reader, reporter, {
      pollMs: config.CHATDB_POLL_MS,
      timeoutMs: config.CHATDB_WATCH_TIMEOUT_MS,
    });
  }
  sender = createAppleScriptSender(
    reporter,
    { dryRun: config.IMESSAGE_DRY_RUN, allowlist: config.IMESSAGE_ALLOWLIST },
    undefined,
    watcher,
  );
  label = config.IMESSAGE_DRY_RUN
    ? "applescript (DRY RUN — not sending, chat.db watcher off)"
    : `applescript (live, allowlist of ${config.IMESSAGE_ALLOWLIST.length}, chat.db watcher on)`;
} else {
  sender = createSimulatorSender(reporter, {
    sentMs: config.SIMULATOR_SENT_MS,
    deliveredMs: config.SIMULATOR_DELIVERED_MS,
    receivedMs: config.SIMULATOR_RECEIVED_MS,
  });
  label = "simulator";
}

const app = createGatewayServer(sender);
app.listen(config.GATEWAY_PORT, () => {
  console.log(`[gateway] ${label} listening on :${config.GATEWAY_PORT}`);
});