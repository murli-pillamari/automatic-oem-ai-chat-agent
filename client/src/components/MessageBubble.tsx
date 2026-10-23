"use client";

export type ChatMessage = { role: "user" | "model"; content: string; pending?: boolean };

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-xs font-bold">A</div>}
      <div className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${isUser ? "rounded-tr-sm bg-blue-600 text-white" : "rounded-tl-sm border border-slate-700 bg-slate-800 text-slate-100"}`}>
        {message.pending ? <span className="inline-flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"/><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]"/><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]"/></span> : message.content}
      </div>
    </div>
  );
}
