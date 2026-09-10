import { useCallback, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../api";
import type { ChatFile } from "../api";
import { errorMessage } from "../lib/format";
import { usePolledList } from "../lib/usePolledList";
import { useChat } from "../store/chat";
import { describeChatFile } from "./Composer";
import { AttachmentChip, Button, IconButton, Modal, Spinner } from "./ui";

interface Props {
  threadId: string | null;
  onClose: () => void;
}

export function ThreadSettingsDialog({ threadId, onClose }: Props) {
  const thread = useChat((s) => (threadId ? s.meta[threadId] : undefined));
  const draft = useChat((s) => s.draft);
  const tools = useChat((s) => s.tools);
  const models = useChat((s) => s.models);
  const updateSettings = useChat((s) => s.updateSettings);

  const initial = threadId
    ? { prompt: thread?.system_prompt ?? "", tools: thread?.enabled_tools ?? [], model: thread?.model ?? null }
    : { prompt: draft.system_prompt, tools: draft.enabled_tools, model: draft.model };

  const [prompt, setPrompt] = useState(initial.prompt);
  const [enabled, setEnabled] = useState<string[]>(initial.tools);
  const [saving, setSaving] = useState(false);

  const model = models.find((m) => m.id === initial.model);
  const toolsSupported = model?.supports_tools ?? true;

  const save = async () => {
    setSaving(true);
    const ok = await updateSettings(threadId, { system_prompt: prompt.trim() || null, enabled_tools: enabled });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={threadId ? "Chat settings" : "Settings for new chats"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving && <Spinner size={14} className="text-surface" />}
            Save
          </Button>
        </>
      }
    >
      <section>
        <label htmlFor="system-prompt" className="text-sm font-semibold">
          System prompt
        </label>
        <p className="mb-2 text-xs text-ink-muted">
          {threadId
            ? "Instructions the assistant follows for this whole chat. Changes apply to the next reply."
            : "Used when your next new chat starts."}
        </p>
        <textarea
          id="system-prompt"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. You are a concise senior Python reviewer. Answer with bullet points."
          className="w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-ink-muted"
        />
      </section>

      <section className="mt-5">
        <h3 className="text-sm font-semibold">Tools</h3>
        <p className="mb-2 text-xs text-ink-muted">
          {toolsSupported ? "The assistant may call enabled tools while answering." : `${model?.name} doesn't support tools.`}
        </p>
        {tools.length === 0 ? (
          <p className="text-sm text-ink-muted">No tools available.</p>
        ) : (
          <div className="-mx-2">
            {tools.map((t) => (
              <label key={t.name} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-hover">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-neutral-800 dark:accent-neutral-200"
                  checked={enabled.includes(t.name)}
                  disabled={!toolsSupported}
                  onChange={(e) =>
                    setEnabled((prev) => (e.target.checked ? [...prev, t.name] : prev.filter((n) => n !== t.name)))
                  }
                />
                <span>
                  <span className="block text-sm font-medium">{t.display_name}</span>
                  <span className="block text-xs text-ink-muted">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {threadId && (
        <section className="mt-5">
          <h3 className="text-sm font-semibold">Files in this chat</h3>
          <p className="mb-2 text-xs text-ink-muted">
            Attach files with the paperclip. Small files are read in full. Large files are indexed once and searched
            whenever they're relevant, for as long as they're part of this conversation.
          </p>
          <ChatFiles threadId={threadId} />
        </section>
      )}
    </Modal>
  );
}

function ChatFiles({ threadId }: { threadId: string }) {
  const toast = useChat((s) => s.toast);
  const load = useCallback(() => api.listChatFiles(threadId), [threadId]);
  const { items, setItems, error, refresh } = usePolledList<ChatFile>(load);

  const remove = async (file: ChatFile) => {
    setItems((list) => list?.filter((f) => f.id !== file.id) ?? null);
    try {
      await api.deleteChatFile(threadId, file.id);
    } catch (err) {
      toast(errorMessage(err));
      void refresh();
    }
  };

  if (error) return <p className="text-sm text-red-500">Couldn't load files: {error}</p>;
  if (!items) return <Spinner />;
  if (items.length === 0) return <p className="text-sm text-ink-muted">No files attached yet.</p>;

  return (
    <div className="space-y-2">
      {items.map((f) => (
        <div key={f.id} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AttachmentChip
              name={f.filename}
              busy={f.status === "processing"}
              error={f.status === "failed"}
              meta={`${describeChatFile(f.status, f)}${f.status === "ready" && !f.message_id ? " · not sent" : ""}`}
            />
          </div>
          <IconButton label={`Remove ${f.filename}`} onClick={() => void remove(f)}>
            <Trash2 size={16} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
