import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { ArrowUp, Library, Lightbulb, Paperclip, Square } from "lucide-react";
import { api } from "../api";
import type { Attachment, ChatFile } from "../api";
import { cn, errorMessage, formatBytes } from "../lib/format";
import { useChat } from "../store/chat";
import { AttachmentChip, AutoTextarea, IconButton } from "./ui";

interface LocalAttachment {
  localId: string;
  threadId: string;
  filename: string;
  size: number;
  status: "uploading" | ChatFile["status"];
  file: ChatFile | null;
  error: string | null;
}

const POLL_MS = 1000;
const POLL_LIMIT = 600; // ~10 minutes of indexing before giving up

/** Status line for a chat file chip. */
export function describeChatFile(
  status: LocalAttachment["status"],
  file: Pick<ChatFile, "processing" | "size_bytes" | "chunk_count" | "error"> | null,
  size = file?.size_bytes ?? 0,
): string {
  if (status === "uploading") return "Uploading…";
  if (status === "failed") return file?.error ?? "Failed";
  if (status === "processing") return file?.processing === "rag" ? "Indexing for search…" : "Reading…";
  if (file?.processing === "rag") {
    return `${formatBytes(size)} · indexed${file.chunk_count ? ` (${file.chunk_count} chunks)` : ""}`;
  }
  return `${formatBytes(size)} · full text`;
}

export function Composer({ threadId, disabled = false }: { threadId: string | null; disabled?: boolean }) {
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const ensureThread = useChat((s) => s.ensureThread);
  const toast = useChat((s) => s.toast);
  const streaming = useChat((s) => s.streaming);
  const options = useChat((s) => s.options);
  const setOptions = useChat((s) => s.setOptions);
  const modelId = useChat((s) => (threadId ? s.meta[threadId]?.model : s.draft.model));
  const model = useChat((s) => s.models.find((m) => m.id === modelId));

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Moving between existing chats clears the box; a new chat receiving its id keeps it.
  const prevThread = useRef(threadId);
  useEffect(() => {
    const prev = prevThread.current;
    prevThread.current = threadId;
    if (prev !== null && prev !== threadId) {
      setText("");
      setAttachments([]);
    }
    if (window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [threadId]);

  const streamingHere = streaming !== null && streaming.threadId === threadId;
  const uploadsPending = attachments.some((a) => a.status === "uploading" || a.status === "processing");
  const canSend = !disabled && streaming === null && text.trim().length > 0 && !uploadsPending;
  const showThink = model?.supports_reasoning ?? true; // unknown model: let the backend decide
  const knowledgeOn = options.knowledge_mode === "strict";

  const patchAttachment = (localId: string, patch: Partial<LocalAttachment>) =>
    setAttachments((list) => list.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));

  async function waitUntilProcessed(localId: string, tid: string, fileId: string) {
    for (let i = 0; i < POLL_LIMIT; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!mounted.current) return;
      try {
        const file = await api.getChatFile(tid, fileId);
        patchAttachment(localId, { file, status: file.status, error: file.error });
        if (file.status !== "processing") return;
      } catch (err) {
        patchAttachment(localId, { status: "failed", error: errorMessage(err) });
        return;
      }
    }
    patchAttachment(localId, { status: "failed", error: "Processing timed out" });
  }

  async function addFiles(files: File[]) {
    if (files.length === 0 || disabled) return;
    let tid = threadId;
    if (!tid) {
      try {
        tid = await ensureThread(); // chat files belong to a thread, so create it first
      } catch {
        return;
      }
    }
    for (const file of files) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const owner = tid;
      setAttachments((list) => [
        ...list,
        { localId, threadId: owner, filename: file.name, size: file.size, status: "uploading", file: null, error: null },
      ]);
      api
        .uploadChatFile(owner, file)
        .then((record) => {
          patchAttachment(localId, { file: record, status: record.status, error: record.error });
          if (record.status === "processing") void waitUntilProcessed(localId, owner, record.id);
        })
        .catch((err) => {
          patchAttachment(localId, { status: "failed", error: errorMessage(err) });
          toast(`${file.name}: ${errorMessage(err)}`);
        });
    }
  }

  function removeAttachment(a: LocalAttachment) {
    setAttachments((list) => list.filter((x) => x.localId !== a.localId));
    // Not referenced by any message yet, so it's safe to delete server-side.
    if (a.file) api.deleteChatFile(a.threadId, a.file.id).catch(() => {});
  }

  async function submit() {
    if (!canSend) return;
    const content = text.trim();
    const sent = attachments;
    const payload: Attachment[] = sent.flatMap((a) =>
      a.status === "ready" && a.file?.processing
        ? [
            {
              id: a.file.id,
              filename: a.file.filename,
              mime_type: a.file.mime_type,
              size_bytes: a.file.size_bytes,
              processing: a.file.processing,
            },
          ]
        : [],
    );

    setText("");
    setAttachments([]);
    const ok = await send(threadId, content, payload);
    if (!ok && mounted.current) {
      setText((t) => t || content);
      setAttachments((a) => (a.length ? a : sent));
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="w-full shrink-0 px-3 pb-3 sm:px-4">
      <div className="mx-auto w-full max-w-3xl">
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            "rounded-[28px] border bg-surface shadow-sm transition-colors dark:bg-subtle",
            dragging ? "border-dashed border-ink-muted" : "border-line",
          )}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((a) => (
                <AttachmentChip
                  key={a.localId}
                  name={a.filename}
                  busy={a.status === "uploading" || a.status === "processing"}
                  error={a.status === "failed"}
                  meta={describeChatFile(a.status, a.file ?? { processing: null, size_bytes: a.size, chunk_count: null, error: a.error }, a.size)}
                  onRemove={() => removeAttachment(a)}
                />
              ))}
            </div>
          )}

          <AutoTextarea
            textareaRef={textareaRef}
            value={text}
            onChange={setText}
            onPaste={onPaste}
            maxHeight={240}
            placeholder={dragging ? "Drop files to attach" : knowledgeOn ? "Ask your knowledge base" : "Ask anything"}
            aria-label="Message"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            className="block w-full resize-none bg-transparent px-4 pt-3 text-[15px] leading-6 outline-none placeholder:text-ink-muted"
          />

          <div className="flex items-center gap-1.5 p-2">
            <IconButton
              label="Attach files"
              className="h-9 w-9 rounded-full"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={18} />
            </IconButton>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />

            {showThink && (
              <TogglePill
                active={options.think}
                onClick={() => setOptions({ think: !options.think })}
                icon={<Lightbulb size={16} />}
                label="Think"
                title={options.think ? "Thinking on: reasons before answering" : "Thinking off: answers directly"}
              />
            )}
            <TogglePill
              active={knowledgeOn}
              onClick={() => setOptions({ knowledge_mode: knowledgeOn ? "off" : "strict" })}
              icon={<Library size={16} />}
              label="Knowledge base"
              title={
                knowledgeOn
                  ? "Knowledge base on: answers only from your knowledge base documents"
                  : "Knowledge base off: normal chat"
              }
            />

            <div className="flex-1" />

            {streamingHere ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-surface hover:opacity-80"
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                aria-label="Send message"
                title={uploadsPending ? "Waiting for files to finish processing" : undefined}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-surface hover:opacity-80 disabled:opacity-30"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-center text-xs text-ink-muted">
          {api.mode === "mock"
            ? "Mock backend: replies are simulated. Set VITE_USE_MOCK=false to use FastAPI."
            : "AI can make mistakes. Check important info."}
        </p>
      </div>
    </div>
  );
}

function TogglePill({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        active
          ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : "border-line text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {icon}
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}
