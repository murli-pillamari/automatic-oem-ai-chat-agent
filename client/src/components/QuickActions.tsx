"use client";

const actions = [
  ["Explore vehicles", "I’m looking for an electric SUV under ₹20 lakh."],
  ["Book a test drive", "I’d like to book a test drive for the XUV700."],
  ["Track delivery", "Can you check my delivery status?"],
  ["Service support", "I need help with a service issue."]
] as const;

export function QuickActions({ onSelect, disabled }: { onSelect: (message: string) => void; disabled: boolean }) {
  return <div className="flex flex-wrap gap-2">{actions.map(([label, prompt]) => (
    <button key={label} disabled={disabled} onClick={() => onSelect(prompt)} className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 transition hover:border-blue-500 hover:bg-slate-700 disabled:opacity-50">{label}</button>
  ))}</div>;
}
