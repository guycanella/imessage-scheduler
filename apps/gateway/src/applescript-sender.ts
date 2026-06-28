import { spawn } from "node:child_process";
import type { MessageSender } from "./sender.js";
import type { StatusReporter } from "./status-reporter.js";
import type { DeliveryWatcher } from "./delivery-watcher.js";

export interface AppleScriptConfig {
  dryRun: boolean;
  allowlist: string[];
}

export type OsascriptRunner = (recipient: string, body: string) => Promise<void>;

const SEND_SCRIPT = `
on run {targetBuddy, messageText}
  tell application "Messages"
    set targetService to id of 1st account whose service type = iMessage
    set theBuddy to participant targetBuddy of account id targetService
    send messageText to theBuddy
  end tell
end run
`;

export const runViaOsascript: OsascriptRunner = (recipient, body) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("osascript", ["-", recipient, body]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`osascript exited with ${code}: ${stderr.trim()}`));
    });

    child.stdin.write(SEND_SCRIPT);
    child.stdin.end();
  });

export function createAppleScriptSender(
  reporter: StatusReporter,
  config: AppleScriptConfig,
  run: OsascriptRunner = runViaOsascript,
  watcher?: DeliveryWatcher,
): MessageSender {
  return {
    async send({ messageId, to, body }) {
      if (!config.dryRun && config.allowlist.length === 0) {
        throw new Error(
          "refusing to send: set IMESSAGE_ALLOWLIST or keep IMESSAGE_DRY_RUN=true",
        );
      }
      if (config.allowlist.length > 0 && !config.allowlist.includes(to)) {
        throw new Error(`recipient ${to} is not in IMESSAGE_ALLOWLIST`);
      }

      const gatewayGuid = `applescript-${messageId}-${Date.now()}`;

      if (config.dryRun) {
        console.log(`[gateway] DRY RUN — would iMessage ${to}: ${body}`);
        void reporter.report(messageId, "SENT", { gatewayGuid, dryRun: true });
        return { gatewayGuid };
      }

      const since = new Date();
      await run(to, body);
      void reporter.report(messageId, "SENT", { gatewayGuid });
      watcher?.watch({ messageId, recipient: to, body, since });
      
      return { gatewayGuid };
    },
  };
}