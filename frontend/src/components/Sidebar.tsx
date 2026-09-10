import { useMemo, useRef, useState } from "react";
import { Ellipsis, Library, Moon, PanelLeft, Pencil, Search, SquarePen, Sun, Trash2 } from "lucide-react";
import { api } from "../api";
import type { ThreadSummary } from "../api";
import { cn, dateGroup } from "../lib/format";
import { navigate } from "../lib/router";
import { useTheme } from "../lib/theme";
import { useChat } from "../store/chat";
import { KnowledgeBaseDialog } from "./KnowledgeBaseDialog";
import { Button, IconButton, Modal, Spinner, useDismiss } from "./ui";

interface Props {
  open: boolean;
  isMobile: boolean;
  activeThreadId: string | null;
  onClose: () => void;
}

export function Sidebar({ open, isMobile, activeThreadId, onClose }: Props) {
  const threads = useChat((s) => s.threads);
  const cursor = useChat((s) => s.threadsCursor);
  const loading = useChat((s) => s.threadsLoading);
  const loaded = useChat((s) => s.threadsLoaded);
  const loadThreads = useChat((s) => s.loadThreads);
  const [query, setQuery] = useState("");
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const knowledgeOn = useChat((s) => s.options.knowledge_mode === "strict");
  const [theme, toggleTheme] = useTheme();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? threads.filter((t) => t.title.toLowerCase().includes(q)) : threads;
    const map = new Map<string, ThreadSummary[]>();
    for (const t of list) {
      const key = dateGroup(t.updated_at);
      const bucket = map.get(key);
      if (bucket) bucket.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()];
  }, [threads, query]);

  const go = (path: string) => {
    navigate(path);
    if (isMobile) onClose();
  };

  return (
    <>
      {isMobile && open && <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} aria-hidden />}
      <aside
        aria-label="Conversations"
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "z-40 h-full shrink-0 overflow-hidden bg-sidebar transition-[width,translate] duration-200 ease-out",
          isMobile
            ? cn("fixed inset-y-0 left-0 w-[280px] shadow-xl", open ? "translate-x-0" : "-translate-x-full")
            : open
              ? "w-[260px]"
              : "w-0",
        )}
      >
        <div className="flex h-full w-[260px] flex-col max-md:w-[280px]">
          <div className="flex h-14 items-center justify-between px-2">
            <IconButton label="Close sidebar" onClick={onClose}>
              <PanelLeft size={20} />
            </IconButton>
            <IconButton label="New chat" onClick={() => go("/")}>
              <SquarePen size={20} />
            </IconButton>
          </div>

          <div className="px-2">
            <button
              type="button"
              onClick={() => go("/")}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-hover"
            >
              <SquarePen size={16} />
              New chat
            </button>
            <button
              type="button"
              onClick={() => setKnowledgeOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-hover"
            >
              <Library size={16} />
              Knowledge base
              {knowledgeOn && (
                <span className="ml-auto rounded-full bg-sky-500/15 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-300">
                  On
                </span>
              )}
            </button>
            <label className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-muted focus-within:bg-hover">
              <Search size={16} className="shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                className="w-full bg-transparent text-ink outline-none placeholder:text-ink-muted"
              />
            </label>
          </div>

          <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-4">
            {!loaded && loading && (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
            {loaded && threads.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-muted">No conversations yet</p>
            )}
            {threads.length > 0 && groups.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-muted">No chats match “{query}”</p>
            )}

            {groups.map(([label, items]) => (
              <section key={label} className="mt-3 first:mt-0">
                <h3 className="px-3 pb-1 pt-2 text-xs font-medium text-ink-muted">{label}</h3>
                <ul>
                  {items.map((t) => (
                    <li key={t.id}>
                      <ThreadRow thread={t} active={t.id === activeThreadId} onSelect={() => go(`/c/${t.id}`)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {cursor && !query && (
              <button
                type="button"
                onClick={() => void loadThreads()}
                disabled={loading}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-hover disabled:opacity-60"
              >
                {loading ? <Spinner size={14} /> : null}
                Load more
              </button>
            )}
          </nav>

          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                api.mode === "mock"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
              )}
              title={api.mode === "mock" ? "Using the in-browser mock backend" : "Connected to the FastAPI backend"}
            >
              {api.mode === "mock" ? "Mock backend" : "Live backend"}
            </span>
            <IconButton label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
          </div>
        </div>
      </aside>
      {knowledgeOpen && <KnowledgeBaseDialog onClose={() => setKnowledgeOpen(false)} />}
    </>
  );
}

function ThreadRow({ thread, active, onSelect }: { thread: ThreadSummary; active: boolean; onSelect: () => void }) {
  const renameThread = useChat((s) => s.renameThread);
  const deleteThread = useChat((s) => s.deleteThread);
  const streamingHere = useChat((s) => s.streaming?.threadId === thread.id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState(thread.title);
  const rowRef = useRef<HTMLDivElement>(null);
  useDismiss(rowRef, () => setMenuOpen(false), menuOpen);

  const commit = () => {
    setEditing(false);
    void renameThread(thread.id, value);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        aria-label="Chat title"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setValue(thread.title);
            setEditing(false);
          }
        }}
        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-ink-muted"
      />
    );
  }

  return (
    <div ref={rowRef} className={cn("group relative flex items-center rounded-lg", active ? "bg-hover" : "hover:bg-hover")}>
      <button
        type="button"
        onClick={onSelect}
        title={thread.title}
        aria-current={active ? "page" : undefined}
        className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
      >
        {thread.title}
      </button>
      {streamingHere && <Spinner size={14} className="mr-1" />}
      <button
        type="button"
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          "mr-1 rounded-md p-1 text-ink-muted hover:text-ink",
          !(menuOpen || active) && "md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
        )}
      >
        <Ellipsis size={16} />
      </button>

      {menuOpen && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-line bg-elevated p-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setValue(thread.title);
              setEditing(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-hover"
          >
            <Pencil size={15} /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirming(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-hover dark:text-red-400"
          >
            <Trash2 size={15} /> Delete
          </button>
        </div>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete chat?"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void deleteThread(thread.id);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm">
          This will permanently delete <strong>{thread.title}</strong>, including all its branches and documents.
        </p>
      </Modal>
    </div>
  );
}
