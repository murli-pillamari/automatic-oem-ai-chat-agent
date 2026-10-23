import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db/database.js";
import { runChat } from "./agent/gemini.js";
import { Agent } from "node:http";

const app = express();
app.use(cors({ origin: config.clientOrigin, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "1mb" }));

const chatSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4_000),
  customer: z.object({ name: z.string().trim().max(120).optional(), phone: z.string().trim().max(32).optional() }).optional()
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid chat request", details: parsed.error.flatten() });
  const traceId = crypto.randomUUID().slice(0, 8);
  const totalLabel = `[chat:${traceId}] total request`;
  console.time(totalLabel);
  try {
    const { sessionId: suppliedId, message, customer } = parsed.data;
    const sessionId = suppliedId ?? crypto.randomUUID();
    const sessionLookupLabel = `[chat:${traceId}] SQLite session lookup`;
    console.time(sessionLookupLabel);
    let session;
    try {
      session = db.getSession(sessionId);
    } finally {
      console.timeEnd(sessionLookupLabel);
    }
    if (!session) session = db.createSession(sessionId, customer);
    else if (customer?.name || customer?.phone) session = db.updateSession(sessionId, customer) ?? session;
    db.saveMessage(sessionId, "user", message);
    const output = await runChat(session, message, traceId);
    return res.json({ sessionId, ...output });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process your request.";
    console.error("Chat request failed", error);
    return res.status(500).json({ error: message });
  } finally {
    console.timeEnd(totalLabel);
  }
});

app.get("/api/history", (req, res) => {
  const sessionId = z.string().uuid().safeParse(req.query.sessionId);
  if (!sessionId.success) return res.status(400).json({ error: "A valid sessionId query parameter is required." });
  const session = db.getSession(sessionId.data);
  if (!session) return res.status(404).json({ error: "Session not found." });
  return res.json({ session, messages: db.getMessages(session.id).reverse() });
});

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.listen(config.port, () => console.log(`OEM AI Agent API listening on http://localhost:${config.port}`));
