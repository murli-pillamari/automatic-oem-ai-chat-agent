import { GoogleGenAI, createPartFromFunctionResponse, type Content, type FunctionCall, type Part } from "@google/genai";
import { config } from "../config.js";
import { db } from "../db/database.js";
import { executeLifecycleTool, lifecycleTools } from "./tools.js";
import { systemPrompt } from "./systemPrompt.js";
import type { ChatResponse, LifecycleStage, Session } from "../types/index.js";

const MAX_TOOL_ROUNDS = 2;

function makeHistory(sessionId: string, traceId: string): Content[] {
  const label = `[chat:${traceId}] SQLite history lookup`;
  console.time(label);
  try {
    return db.getMessages(sessionId, 24).reverse()
      .filter((entry) => entry.role === "user" || entry.role === "model")
      .map((entry) => ({ role: entry.role, parts: [{ text: entry.content }] }));
  } finally { console.timeEnd(label); }
}

async function timed<T>(traceId: string, engine: "Gemini" | "Groq", operation: string, action: () => Promise<T>): Promise<T> {
  const label = `[chat:${traceId}] ${engine} API call (${operation})`;
  console.time(label);
  try { return await action(); }
  finally { console.timeEnd(label); }
}

async function executeTool(call: { name?: string; args?: Record<string, unknown> }, session: Session, traceId: string) {
  const name = call.name;
  if (!name) throw new Error("Model returned a tool call without a name.");
  const args = call.args ?? {};
  const label = `[chat:${traceId}] CRM tool execution (${name})`;
  console.time(label);
  try {
    const outcome = await executeLifecycleTool(name, args, session);
    db.saveMessage(session.id, "function", JSON.stringify(outcome.result), { name, args });
    return { name, args, result: outcome.result, stage: outcome.stage };
  } catch (error) {
    const result = { error: error instanceof Error ? error.message : "Unable to complete CRM operation." };
    db.saveMessage(session.id, "function", JSON.stringify(result), { name, args });
    return { name, args, result, stage: session.stage };
  } finally { console.timeEnd(label); }
}

function geminiTools() {
  return [{ functionDeclarations: lifecycleTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters
  })) }];
}

function supportsThinkingBudget(model: string) {
  // Gemini 3.5 Flash Lite does not accept this field; sending it causes INVALID_ARGUMENT.
  return /^gemini-(?:2\.5|3\.8)-flash/i.test(model);
}

async function generateGemini(ai: GoogleGenAI, model: string, contents: Content[], traceId: string, operation: string) {
  return timed(traceId, "Gemini", operation, async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), config.geminiRequestTimeoutMs);
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: 800,
          // Apply only to models that support thinking configuration; Lite rejects it.
          ...(supportsThinkingBudget(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          tools: geminiTools(),
          abortSignal: controller.signal,
          httpOptions: { timeout: config.geminiRequestTimeoutMs, retryOptions: { attempts: 1 } }
        }
      });
    } finally { clearTimeout(abortTimer); }
  });
}

function isUnavailableModelError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:404|not[ _-]?found|unsupported model|model.*not.*available)/i.test(message);
}

async function generateGeminiInitial(ai: GoogleGenAI, contents: Content[], traceId: string) {
  let lastError: unknown;
  for (const model of config.geminiFallbackModels) {
    try {
      const response = await generateGemini(ai, model, contents, traceId, `generateContent initial / ${model}`);
      return { model, response };
    } catch (error) {
      lastError = error;
      if (!isUnavailableModelError(error)) throw error;
      console.warn(`[chat:${traceId}] Gemini model unavailable: ${model}; trying configured fallback.`);
    }
  }
  throw lastError;
}

async function runGemini(session: Session, message: string, traceId: string): Promise<Omit<ChatResponse, "sessionId">> {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const contents = makeHistory(session.id, traceId);
  contents.push({ role: "user", parts: [{ text: message }] });

  const first = await generateGeminiInitial(ai, contents, traceId);
  let response = first.response;
  const executed: Array<{ name: string; result: unknown }> = [];
  let stage: LifecycleStage = session.stage;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = response.functionCalls ?? [];
    if (!calls.length) break;
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    const functionResponses: Part[] = [];
    for (const call of calls as FunctionCall[]) {
      const result = await executeTool(call, session, traceId);
      stage = result.stage;
      executed.push({ name: result.name, result: result.result });
      functionResponses.push(createPartFromFunctionResponse(call.id ?? result.name, result.name, { output: result.result }));
    }
    contents.push({ role: "user", parts: functionResponses });
    response = await generateGemini(ai, first.model, contents, traceId, `generateContent tool response round ${round + 1}`);
  }

  const reply = response.text?.trim() || "I've recorded that. What would you like to do next?";
  db.updateSession(session.id, { stage });
  db.saveMessage(session.id, "model", reply, executed.length ? executed : undefined);
  return { reply, stage, toolCalls: executed };
}

type GroqToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type GroqMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_call_id?: string; tool_calls?: GroqToolCall[] };
type GroqResponse = { choices?: Array<{ message?: { content?: string | null; tool_calls?: GroqToolCall[] } }> };

async function callGroq(messages: GroqMessage[], traceId: string, operation: string): Promise<GroqResponse> {
  return timed(traceId, "Groq", operation, async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), config.groqRequestTimeoutMs);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${config.groqApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.groqModel,
          messages,
          tools: lifecycleTools.map((tool) => ({ type: "function", function: tool })),
          tool_choice: "auto",
          max_tokens: 800,
          temperature: 0.2
        })
      });
      if (!response.ok) throw new Error(`Groq request failed (${response.status}): ${await response.text()}`);
      return await response.json() as GroqResponse;
    } finally { clearTimeout(abortTimer); }
  });
}

async function runGroq(session: Session, message: string, traceId: string): Promise<Omit<ChatResponse, "sessionId">> {
  const history = makeHistory(session.id, traceId);
  const messages: GroqMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((entry) => ({ role: entry.role === "model" ? "assistant" as const : "user" as const, content: (entry.parts ?? []).map((part) => "text" in part ? part.text : "").join("") })),
    { role: "user", content: message }
  ];
  const executed: Array<{ name: string; result: unknown }> = [];
  let stage: LifecycleStage = session.stage;
  let response = await callGroq(messages, traceId, "chat completion initial");

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const assistant = response.choices?.[0]?.message;
    const calls = assistant?.tool_calls ?? [];
    if (!calls.length) {
      const reply = assistant?.content?.trim() || "I've recorded that. What would you like to do next?";
      db.updateSession(session.id, { stage });
      db.saveMessage(session.id, "model", reply, executed.length ? executed : undefined);
      return { reply, stage, toolCalls: executed };
    }
    messages.push({ role: "assistant", content: assistant?.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; }
      catch { args = {}; }
      const result = await executeTool({ name: call.function.name, args }, session, traceId);
      stage = result.stage;
      executed.push({ name: result.name, result: result.result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.result) });
    }
    response = await callGroq(messages, traceId, `chat completion tool response round ${round + 1}`);
  }

  const reply = response.choices?.[0]?.message?.content?.trim() || "I completed the requested action. What else can I help with?";
  db.updateSession(session.id, { stage });
  db.saveMessage(session.id, "model", reply, executed.length ? executed : undefined);
  return { reply, stage, toolCalls: executed };
}

export async function runChat(session: Session, message: string, traceId: string): Promise<Omit<ChatResponse, "sessionId">> {
  return config.groqApiKey ? runGroq(session, message, traceId) : runGemini(session, message, traceId);
}
