import { loadConfig } from "./config.js";
import { createHttpStatusReporter } from "./status-reporter.js";
import { createSimulatorSender } from "./simulator.js";
import { createGatewayServer } from "./server.js";

const config = loadConfig();
const reporter = createHttpStatusReporter(config.BACKEND_WEBHOOK_URL);
const sender = createSimulatorSender(reporter, {
    sentMs: config.SIMULATOR_SENT_MS,
    deliveredMs: config.SIMULATOR_DELIVERED_MS,
    receivedMs: config.SIMULATOR_RECEIVED_MS,
});

const app = createGatewayServer(sender);
app.listen(config.GATEWAY_PORT, () => {
    console.log(`[gateway] simulator listening on :${config.GATEWAY_PORT}`);
});