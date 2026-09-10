import { useRef, useState } from "react";
import { Check, ChevronDown, PanelLeft, SlidersHorizontal, SquarePen } from "lucide-react";
import { navigate } from "../lib/router";
import { useChat } from "../store/chat";
import { ThreadSettingsDialog } from "./ThreadSettingsDialog";
import { IconButton, useDismiss } from "./ui";

interface Props {
  threadId: string | null;
  showSidebarButton: boolean;
  onOpenSidebar: () => void;
}

export function ChatHeader({ threadId, showSidebarButton, onOpenSidebar }: Props) {
  const models = useChat((s) => s.models);
  const thread = useChat((s) => (threadId ? s.meta[threadId] : undefined));
  const draft = useChat((s) => s.draft);
  const updateSettings = useChat((s) => s.updateSettings);

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, () => setMenuOpen(false), menuOpen);

  const modelId = threadId ? (thread?.model ?? null) : draft.model;
  const current = models.find((m) => m.id === modelId) ?? (modelId ? undefined : models[0]);
  const label = current?.name ?? modelId ?? "Chat";
  const customized = threadId
    ? Boolean(thread?.system_prompt) || (thread?.enabled_tools.length ?? 0) > 0
    : Boolean(draft.system_prompt.trim()) || draft.enabled_tools.length > 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 px-2">
      {showSidebarButton && (
        <>
          <IconButton label="Open sidebar" onClick={onOpenSidebar}>
            <PanelLeft size={20} />
          </IconButton>
          <IconButton label="New chat" onClick={() => navigate("/")}>
            <SquarePen size={20} />
          </IconButton>
        </>
      )}

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={models.length === 0}
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-lg font-medium hover:bg-hover disabled:hover:bg-transparent"
        >
          <span className="max-w-[45vw] truncate">{label}</span>
          {models.length > 0 && <ChevronDown size={16} className="text-ink-muted" />}
        </button>

        {menuOpen && (
          <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-72 rounded-2xl border border-line bg-elevated p-1.5 shadow-xl">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={m.id === current?.id}
                onClick={() => {
                  setMenuOpen(false);
                  void updateSettings(threadId, { model: m.id });
                }}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{m.name}</span>
                  {m.description && <span className="block text-xs text-ink-muted">{m.description}</span>}
                </span>
                {m.id === current?.id && <Check size={16} className="mt-0.5 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="System prompt, tools & documents"
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-muted hover:bg-hover hover:text-ink"
      >
        <SlidersHorizontal size={16} />
        <span className="hidden sm:inline">{threadId ? "Chat settings" : "Settings"}</span>
        {customized && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="customized" />}
      </button>

      {settingsOpen && <ThreadSettingsDialog threadId={threadId} onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
