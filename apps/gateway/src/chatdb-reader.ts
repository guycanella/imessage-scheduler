import Database from "better-sqlite3";
import {
  appleDateToJsDate,
  chatDbFlagsToStatus,
  APPLE_EPOCH_OFFSET_SECONDS,
  type MessageStatus,
} from "@ims/shared";

export interface ChatDbRow {
  ROWID: number;
  guid: string;
  is_sent: number | null;
  is_delivered: number | null;
  is_read: number | null;
  error: number | null;
  date: number | null;
  date_delivered: number | null;
  date_read: number | null;
  service: string | null;
}

export interface OutgoingMatch {
  guid: string;
  status: MessageStatus;
  error: number;
  at: Date | null;
}

export interface ChatDbReader {
  findOutgoing(recipient: string, body: string, since: Date): OutgoingMatch | null;
  close(): void;
}

const FIND_OUTGOING = `
SELECT m.ROWID, m.guid, m.is_sent, m.is_delivered, m.is_read, m.error,
       m.date, m.date_delivered, m.date_read, m.service
FROM message m
JOIN handle h ON h.ROWID = m.handle_id
WHERE m.is_from_me = 1 AND h.id = ? AND m.text = ? AND m.date >= ?
ORDER BY m.date DESC
LIMIT 1
`;

export function jsDateToAppleNs(date: Date): bigint {
  return (
    (BigInt(date.getTime()) - BigInt(APPLE_EPOCH_OFFSET_SECONDS) * 1000n) *
    1_000_000n
  );
}

export function classifyRow(row: ChatDbRow): MessageStatus | null {
  if ((row.error ?? 0) !== 0) return "FAILED";
  return chatDbFlagsToStatus(row);
}

function timestampFor(row: ChatDbRow, status: MessageStatus): Date | null {
  if (status === "RECEIVED") return appleDateToJsDate(row.date_read);
  if (status === "DELIVERED") return appleDateToJsDate(row.date_delivered);
  return appleDateToJsDate(row.date);
}

export function createChatDbReader(path: string): ChatDbReader {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const stmt = db.prepare(FIND_OUTGOING);

  return {
    findOutgoing(recipient, body, since) {
      const row = stmt.get(recipient, body, jsDateToAppleNs(since)) as
        | ChatDbRow
        | undefined;
      if (!row) return null;
      const status = classifyRow(row);
      if (!status) return null;
      return {
        guid: row.guid,
        status,
        error: row.error ?? 0,
        at: timestampFor(row, status),
      };
    },
    close() {
      db.close();
    },
  };
}