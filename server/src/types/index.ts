export type LifecycleStage = "lead" | "sales" | "ownership" | "after_sales";
export type MessageRole = "user" | "model" | "function";

export interface StoredMessage {
  id: number;
  session_id: string;
  role: MessageRole;
  content: string;
  tool_call_details: string | null;
  timestamp: string;
}

export interface Session {
  id: string;
  customer_phone: string | null;
  customer_name: string | null;
  stage: LifecycleStage;
  created_at: string;
}

export interface ChatRequest {
  sessionId?: string;
  message: string;
  customer?: { name?: string; phone?: string };
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  stage: LifecycleStage;
  toolCalls: Array<{ name: string; result: unknown }>;
}
