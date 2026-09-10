import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy, FileText, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/format";

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors",
        "hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  variant = "secondary",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-ink text-surface hover:opacity-85",
        variant === "secondary" && "border border-line hover:bg-hover",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...rest}
    />
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn("animate-spin text-ink-muted", className)} aria-label="Loading" />;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}

export function CopyButton({
  getText,
  label = "Copy",
  className,
}: {
  getText: () => string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <IconButton
      label={copied ? "Copied" : label}
      className={className}
      onClick={async () => setCopied(await copyText(getText()))}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </IconButton>
  );
}

/** Calls `onOutside` on pointer-down outside `ref` or on Escape, while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  const callback = useRef(onOutside);
  callback.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) callback.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") callback.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, active]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex max-h-[90dvh] w-full flex-col rounded-2xl border border-line bg-elevated text-ink shadow-2xl",
          size === "sm" ? "max-w-md" : "max-w-xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-line py-3 pl-5 pr-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function AutoTextarea({
  value,
  onChange,
  maxHeight = 240,
  textareaRef,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  maxHeight?: number;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? innerRef;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight, ref]);

  return <textarea ref={ref} rows={1} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function AttachmentChip({
  name,
  meta,
  error = false,
  busy = false,
  onRemove,
}: {
  name: string;
  meta?: string;
  error?: boolean;
  busy?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-2 rounded-xl border bg-surface py-1.5 pl-2 pr-1.5 text-sm",
        error ? "border-red-500/50" : "border-line",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          error ? "bg-red-500/15 text-red-500" : "bg-subtle text-ink-muted",
        )}
      >
        {busy ? <Spinner size={16} /> : <FileText size={16} />}
      </span>
      <div className="min-w-0 pr-1">
        <div className="max-w-[180px] truncate font-medium">{name}</div>
        {meta && (
          <div className={cn("max-w-[180px] truncate text-xs", error ? "text-red-500" : "text-ink-muted")}>{meta}</div>
        )}
      </div>
      {onRemove && (
        <IconButton label={`Remove ${name}`} className="h-6 w-6 rounded-full" onClick={onRemove}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}

export function ThinkingIndicator() {
  return (
    <div className="flex h-7 items-center gap-1" role="status" aria-label="Assistant is thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-bounce rounded-full bg-ink-muted"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}
