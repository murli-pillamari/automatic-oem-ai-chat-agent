export type Stage = "lead" | "sales" | "ownership" | "after_sales";
export type ChatResult = { sessionId: string; reply: string; stage: Stage; toolCalls: Array<{ name: string; result: unknown }> };

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function sendChat(input: { sessionId?: string; message: string }): Promise<ChatResult> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json() as ChatResult & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The assistant could not respond.");
  return data;
}
