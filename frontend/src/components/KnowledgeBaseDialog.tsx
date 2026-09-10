import { useCallback, useRef, useState } from "react";
import { Library, Trash2, Upload } from "lucide-react";
import { api } from "../api";
import type { KnowledgeDocument } from "../api";
import { errorMessage, formatBytes } from "../lib/format";
import { usePolledList } from "../lib/usePolledList";
import { useChat } from "../store/chat";
import { AttachmentChip, Button, IconButton, Modal, Spinner } from "./ui";

export function KnowledgeBaseDialog({ onClose }: { onClose: () => void }) {
  const toast = useChat((s) => s.toast);
  const knowledgeMode = useChat((s) => s.options.knowledge_mode);
  const setOptions = useChat((s) => s.setOptions);

  const load = useCallback(() => api.listKnowledge(), []);
  const { items, setItems, error, refresh } = usePolledList<KnowledgeDocument>(load);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (files: File[]) => {
    await Promise.all(
      files.map(async (file) => {
        setUploading((n) => n + 1);
        try {
          await api.uploadKnowledge(file);
        } catch (err) {
          toast(`${file.name}: ${errorMessage(err)}`);
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
    await refresh();
  };

  const remove = async (doc: KnowledgeDocument) => {
    setItems((list) => list?.filter((d) => d.id !== doc.id) ?? null);
    try {
      await api.deleteKnowledge(doc.id);
    } catch (err) {
      toast(errorMessage(err));
      void refresh();
    }
  };

  const readyCount = items?.filter((d) => d.status === "ready").length ?? 0;
  const on = knowledgeMode === "strict";

  return (
    <Modal
      open
      onClose={onClose}
      title="Knowledge base"
      footer={
        <>
          <Button onClick={() => setOptions({ knowledge_mode: on ? "off" : "strict" })}>
            <Library size={14} />
            {on ? "Turn off Knowledge base mode" : "Turn on Knowledge base mode"}
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        Shared documents available to every chat. When <strong className="text-ink">Knowledge base</strong> is on in the
        message box, the assistant answers <strong className="text-ink">only</strong> from what it retrieves here and
        says so when it finds nothing relevant.
      </p>

      <div className="mt-4 space-y-2">
        {error && <p className="text-sm text-red-500">Couldn't load the knowledge base: {error}</p>}
        {!error && !items && <Spinner />}
        {items?.length === 0 && (
          <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
            No documents yet. Upload PDFs, docs, or text files to build your knowledge base.
          </div>
        )}
        {items?.map((d) => (
          <div key={d.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <AttachmentChip
                name={d.filename}
                busy={d.status === "processing"}
                error={d.status === "failed"}
                meta={
                  d.status === "processing"
                    ? "Indexing…"
                    : d.status === "failed"
                      ? (d.error ?? "Failed to index")
                      : `${formatBytes(d.size_bytes)}${d.chunk_count != null ? ` · ${d.chunk_count} chunks` : ""}`
                }
              />
            </div>
            <IconButton label={`Delete ${d.filename}`} onClick={() => void remove(d)}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-muted">
          {items ? `${readyCount} of ${items.length} ready` : ""}
        </span>
        <Button onClick={() => inputRef.current?.click()} disabled={uploading > 0}>
          {uploading > 0 ? <Spinner size={14} /> : <Upload size={14} />}
          Upload documents
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </Modal>
  );
}
