import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import type { LifecycleStage, MessageRole, Session, StoredMessage } from "../types/index.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
const sqlite = new Database(config.databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    customer_phone TEXT,
    customer_name TEXT,
    stage TEXT DEFAULT 'lead',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT CHECK(role IN ('user', 'model', 'function')),
    content TEXT,
    tool_call_details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp ON messages(session_id, timestamp, id);
`);

export const db = {
  createSession(id: string, customer?: { name?: string; phone?: string }) {
    sqlite.prepare(`INSERT INTO sessions (id, customer_name, customer_phone) VALUES (?, ?, ?)`)
      .run(id, customer?.name ?? null, customer?.phone ?? null);
    return this.getSession(id)!;
  },

  getSession(id: string): Session | undefined {
    return sqlite.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
  },

  updateSession(id: string, updates: { name?: string; phone?: string; stage?: LifecycleStage }) {
    const current = this.getSession(id);
    if (!current) return undefined;
    sqlite.prepare(`UPDATE sessions SET customer_name = ?, customer_phone = ?, stage = ? WHERE id = ?`).run(
      updates.name ?? current.customer_name,
      updates.phone ?? current.customer_phone,
      updates.stage ?? current.stage,
      id
    );
    return this.getSession(id)!;
  },

  saveMessage(sessionId: string, role: MessageRole, content: string, toolCallDetails?: unknown) {
    sqlite.prepare(`INSERT INTO messages (session_id, role, content, tool_call_details) VALUES (?, ?, ?, ?)`)
      .run(sessionId, role, content, toolCallDetails ? JSON.stringify(toolCallDetails) : null);
  },

  getMessages(sessionId: string, limit = 50): StoredMessage[] {
    return sqlite.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?`)
      .all(sessionId, limit) as StoredMessage[];
  },

  findLocalCustomer(phone: string) {
    return sqlite.prepare(`SELECT * FROM sessions WHERE customer_phone = ? ORDER BY created_at DESC LIMIT 1`)
      .get(phone) as Session | undefined;
  },

  close() { sqlite.close(); }
};
