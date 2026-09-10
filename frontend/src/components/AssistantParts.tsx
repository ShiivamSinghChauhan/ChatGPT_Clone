import { useState } from "react";
import { Brain, ChevronRight, CircleAlert, Library, Paperclip, Wrench } from "lucide-react";
import type { Source, ToolCall } from "../api";
import { cn } from "../lib/format";
import { Spinner } from "./ui";

export function Reasoning({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-ink-muted hover:text-ink"
      >
        <Brain size={15} />
        <span className={cn(active && "animate-pulse")}>{active ? "Thinking…" : "Thought process"}</span>
        <ChevronRight size={14} className={cn("transition-transform", open && "rotate-90")} />
      </button>
      {open && <div className="mt-2 whitespace-pre-wrap border-l-2 border-line pl-3 text-ink-muted">{text}</div>}
    </div>
  );
}

function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function ToolCallCard({ call, displayName }: { call: ToolCall; displayName?: string }) {
  const [open, setOpen] = useState(false);
  const name = displayName ?? call.name;
  const label =
    call.status === "running" ? `Using ${name}…` : call.status === "error" ? `${name} failed` : `Used ${name}`;

  return (
    <div className={cn("max-w-full rounded-xl border border-line text-sm", open ? "w-full" : "w-fit")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-ink-muted hover:text-ink"
      >
        {call.status === "running" ? (
          <Spinner size={14} />
        ) : call.status === "error" ? (
          <CircleAlert size={14} className="text-red-500" />
        ) : (
          <Wrench size={14} />
        )}
        <span>{label}</span>
        <ChevronRight size={14} className={cn("ml-auto transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <CodePanel label="Arguments" text={JSON.stringify(call.arguments, null, 2)} />
          {call.output !== null && <CodePanel label="Output" text={pretty(call.output)} />}
        </div>
      )}
    </div>
  );
}

function CodePanel({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-lg bg-subtle p-2.5 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function OriginIcon({ origin }: { origin: Source["origin"] }) {
  return origin === "knowledge_base" ? (
    <Library size={12} className="shrink-0" aria-label="Knowledge base" />
  ) : (
    <Paperclip size={12} className="shrink-0" aria-label="Chat file" />
  );
}

export function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {sources.map((s, i) => (
          <button
            key={s.chunk_id}
            type="button"
            title={s.snippet}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex max-w-[240px] items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted hover:bg-hover hover:text-ink"
          >
            <span className="font-semibold">{i + 1}</span>
            <OriginIcon origin={s.origin} />
            <span className="truncate">
              {s.filename}
              {s.page != null && ` · p.${s.page}`}
            </span>
          </button>
        ))}
      </div>
      {open && (
        <ol className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <li key={s.chunk_id} className="rounded-xl border border-line p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-ink-muted">
                <span className="font-semibold text-ink">[{i + 1}]</span>
                <OriginIcon origin={s.origin} />
                <span className="truncate">{s.filename}</span>
                <span>{s.origin === "knowledge_base" ? "knowledge base" : "chat file"}</span>
                {s.page != null && <span>p.{s.page}</span>}
                {s.score != null && <span className="ml-auto tabular-nums">score {s.score.toFixed(2)}</span>}
              </div>
              <p className="whitespace-pre-wrap text-ink-muted">{s.snippet}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
