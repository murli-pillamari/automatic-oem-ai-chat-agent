"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { sendChat, type Stage } from "../lib/api";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { QuickActions } from "./QuickActions";

const initialMessage: ChatMessage = { role: "model", content: "Welcome to Aster. I can help you discover a vehicle, arrange a test drive, check delivery, or get service support." };
const stages: Record<Stage, string> = { lead: "Lead", sales: "Sales", ownership: "Ownership", after_sales: "After-sales" };

export function ChatContainer() {
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [stage, setStage] = useState<Stage>("lead");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function submit(message = input) {
    const clean = message.trim();
    if (!clean || busy) return;
    setMessages((current) => [...current, { role: "user", content: clean }, { role: "model", content: "", pending: true }]);
    setInput(""); setBusy(true);
    try {
      const result = await sendChat({ sessionId, message: clean });
      setSessionId(result.sessionId); setStage(result.stage);
      setMessages((current) => [...current.slice(0, -1), { role: "model", content: result.reply }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Please try again.";
      setMessages((current) => [...current.slice(0, -1), { role: "model", content: `I’m sorry, I couldn’t complete that request. ${detail}` }]);
    } finally { setBusy(false); }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void submit(); }
  return (
    <section className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-blue-950/30">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-5 py-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-700 font-bold text-white">A</div><div><h1 className="font-semibold">Aster OEM Concierge</h1><p className="text-xs text-slate-400">Secure automotive lifecycle assistance</p></div></div>
        <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-300">{stages[stage]}</span>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-7">{messages.map((message, index) => <MessageBubble key={index} message={message} />)}<div ref={bottomRef} /></div>
      <footer className="border-t border-slate-800 bg-slate-900 p-4 sm:px-7 sm:py-5"><QuickActions disabled={busy} onSelect={(prompt) => void submit(prompt)} /><form onSubmit={onSubmit} className="mt-3 flex gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder="Ask Aster anything about your journey..." rows={1} disabled={busy} className="min-h-11 flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm outline-none placeholder:text-slate-500 focus:border-blue-500 disabled:opacity-60"/><button disabled={busy || !input.trim()} className="rounded-xl bg-blue-600 px-5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">Send</button></form><p className="mt-2 text-xs text-slate-500">Don’t share passwords, payment details, or one-time codes.</p></footer>
    </section>
  );
}
