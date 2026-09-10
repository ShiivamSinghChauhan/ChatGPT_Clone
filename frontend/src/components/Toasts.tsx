import { X } from "lucide-react";
import { cn } from "../lib/format";
import { useChat } from "../store/chat";

export function Toasts() {
  const toasts = useChat((s) => s.toasts);
  const dismiss = useChat((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg",
            t.kind === "error" ? "bg-red-600 text-white" : "bg-ink text-surface",
          )}
        >
          <span className="flex-1 break-words">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="opacity-80 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
