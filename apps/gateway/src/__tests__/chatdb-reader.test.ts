import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import {
  createChatDbReader,
  jsDateToAppleNs,
  classifyRow,
  type ChatDbReader,
  type ChatDbRow,
} from "../chatdb-reader.js";

const RECIPIENT = "+5581992592626";
const OTHER = "+15550000000";
const dbPath = join(tmpdir(), `chatdb-fixture-${Date.now()}.db`);

const now = new Date();
const old = new Date(now.getTime() - 3_600_000);

function seed() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, handle_id INTEGER,
      is_from_me INTEGER, is_sent INTEGER, is_delivered INTEGER, is_read INTEGER,
      date INTEGER, date_delivered INTEGER, date_read INTEGER, error INTEGER, service TEXT
    );
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  `);
  db.prepare("INSERT INTO handle VALUES (1, ?, 'iMessage')").run(RECIPIENT);
  db.prepare("INSERT INTO handle VALUES (2, ?, 'iMessage')").run(OTHER);

  const ins = db.prepare(`INSERT INTO message
    (guid, text, handle_id, is_from_me, is_sent, is_delivered, is_read, date, date_delivered, date_read, error, service)
    VALUES (@guid,@text,@handle,1,@sent,@delivered,@read,@date,@dd,@dr,@error,'iMessage')`);

  const nowNs = jsDateToAppleNs(now);
  const oldNs = jsDateToAppleNs(old);

  ins.run({ guid: "g-delivered", text: "delivered case", handle: 1, sent: 1, delivered: 1, read: 0, date: nowNs, dd: nowNs, dr: 0n, error: 0 });
  ins.run({ guid: "g-read", text: "read case", handle: 1, sent: 1, delivered: 1, read: 1, date: nowNs, dd: nowNs, dr: nowNs, error: 0 });
  ins.run({ guid: "g-error", text: "error case", handle: 1, sent: 1, delivered: 0, read: 0, date: nowNs, dd: 0n, dr: 0n, error: 1 });
  ins.run({ guid: "g-sent", text: "pending case", handle: 1, sent: 1, delivered: 0, read: 0, date: nowNs, dd: 0n, dr: 0n, error: 0 });
  ins.run({ guid: "g-old", text: "old case", handle: 1, sent: 1, delivered: 1, read: 1, date: oldNs, dd: oldNs, dr: oldNs, error: 0 });
  ins.run({ guid: "g-other", text: "delivered case", handle: 2, sent: 1, delivered: 1, read: 0, date: nowNs, dd: nowNs, dr: 0n, error: 0 });
  db.close();
}

let reader: ChatDbReader;
const since = new Date(now.getTime() - 5_000);

beforeAll(() => {
  seed();
  reader = createChatDbReader(dbPath);
});

afterAll(() => {
  reader.close();
  rmSync(dbPath, { force: true });
});

describe("classifyRow", () => {
  const base: ChatDbRow = {
    ROWID: 1, guid: "g", is_sent: 1, is_delivered: 0, is_read: 0,
    error: 0, date: 1, date_delivered: 0, date_read: 0, service: "iMessage",
  };

  it("maps a non-zero error column to FAILED first", () => {
    expect(classifyRow({ ...base, is_delivered: 1, error: 22 })).toBe("FAILED");
  });

  it("maps read to RECEIVED, delivered to DELIVERED, sent to SENT", () => {
    expect(classifyRow({ ...base, is_delivered: 1, date_read: 999 })).toBe("RECEIVED");
    expect(classifyRow({ ...base, is_delivered: 1 })).toBe("DELIVERED");
    expect(classifyRow(base)).toBe("SENT");
  });

  it("returns null when nothing has happened yet", () => {
    expect(classifyRow({ ...base, is_sent: 0 })).toBeNull();
  });
});

describe("findOutgoing against a chat.db-shaped fixture", () => {
  it("classifies a delivered message and reads date_delivered", () => {
    const m = reader.findOutgoing(RECIPIENT, "delivered case", since);
    expect(m?.status).toBe("DELIVERED");
    expect(m?.guid).toBe("g-delivered");
    expect(m?.at?.getTime()).toBeCloseTo(now.getTime(), -3);
  });

  it("classifies a read message as RECEIVED", () => {
    expect(reader.findOutgoing(RECIPIENT, "read case", since)?.status).toBe("RECEIVED");
  });

  it("classifies an errored message as FAILED with the error code", () => {
    const m = reader.findOutgoing(RECIPIENT, "error case", since);
    expect(m?.status).toBe("FAILED");
    expect(m?.error).toBe(1);
  });

  it("classifies a sent-only message as SENT", () => {
    expect(reader.findOutgoing(RECIPIENT, "pending case", since)?.status).toBe("SENT");
  });

  it("ignores messages older than the since cutoff", () => {
    expect(reader.findOutgoing(RECIPIENT, "old case", since)).toBeNull();
  });

  it("does not match a different recipient handle", () => {
    expect(reader.findOutgoing("+19998887777", "delivered case", since)).toBeNull();
  });

  it("does not match different body text", () => {
    expect(reader.findOutgoing(RECIPIENT, "no such text", since)).toBeNull();
  });
});