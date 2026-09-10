import { create } from "zustand";
import { api, ApiError, isAbortError } from "../api";
import type {
  Attachment,
  Feedback,
  GenerationOptions,
  MessageNode,
  Model,
  StreamEvent,
  Thread,
  ThreadSummary,
  Tool,
  UpdateThreadBody,
} from "../api";
import { getRouteThreadId, navigate } from "../lib/router";
import { activePath, buildChildIndex, newestLeaf } from "../lib/tree";

export interface ThreadData {
  status: "loading" | "ready" | "error";
  error: string | null;
  nodes: Record<string, MessageNode>;
  /** The branch currently shown (mirrors Thread.current_leaf_id). */
  leafId: string | null;
}

/** Settings used when the first message of a new chat creates the thread. */
export interface DraftSettings {
  system_prompt: string;
  model: string | null;
  enabled_tools: string[];
}

export type SettingsPatch = Pick<UpdateThreadBody, "system_prompt" | "model" | "enabled_tools">;

export interface Toast {
  id: number;
  text: string;
  kind: "error" | "info";
}

interface Streaming {
  threadId: string;
  /** null until the server sends `assistant_start`. */
  assistantId: string | null;
  controller: AbortController;
}

interface ChatState {
  models: Model[];
  tools: Tool[];
  threads: ThreadSummary[];
  threadsCursor: string | null;
  threadsLoading: boolean;
  threadsLoaded: boolean;
  meta: Record<string, Thread>;
  data: Record<string, ThreadData>;
  streaming: Streaming | null;
  draft: DraftSettings;
  /** Composer switches (Think, Knowledge base), sent with every send/edit/regenerate. */
  options: GenerationOptions;
  toasts: Toast[];

  init(): Promise<void>;
  setOptions(patch: Partial<GenerationOptions>): void;
  loadThreads(reset?: boolean): Promise<void>;
  openThread(threadId: string): Promise<void>;
  ensureThread(): Promise<string>;
  send(threadId: string | null, content: string, attachments: Attachment[]): Promise<boolean>;
  edit(threadId: string, messageId: string, content: string): Promise<boolean>;
  regenerate(threadId: string, assistantId: string): Promise<void>;
  stop(): void;
  switchBranch(threadId: string, siblingId: string): void;
  renameThread(threadId: string, title: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  updateSettings(threadId: string | null, patch: SettingsPatch): Promise<boolean>;
  setFeedback(threadId: string, messageId: string, rating: Feedback): Promise<void>;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
}

export const TEMP_PREFIX = "temp-";
export const isTempId = (id: string) => id.startsWith(TEMP_PREFIX);

const DRAFT_KEY = "draft-settings";

function loadDraft(): DraftSettings {
  const fallback: DraftSettings = { system_prompt: "", model: null, enabled_tools: [] };
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveDraft(draft: DraftSettings) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

const OPTIONS_KEY = "composer-options";

function loadOptions(): GenerationOptions {
  const fallback: GenerationOptions = { think: true, knowledge_mode: "off" };
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

const summary = ({ id, title, created_at, updated_at }: Thread): ThreadSummary => ({
  id,
  title,
  created_at,
  updated_at,
});

let toastSeq = 0;
let initialized = false;

export const useChat = create<ChatState>()((set, get) => {
  // A send is "in flight" from the click until streaming state exists (thread creation can take a moment).
  let sendInFlight = false;
  const isBusy = () => sendInFlight || get().streaming !== null;

  const patchData = (threadId: string, fn: (d: ThreadData) => Partial<ThreadData>) =>
    set((s) => {
      const d = s.data[threadId];
      return d ? { data: { ...s.data, [threadId]: { ...d, ...fn(d) } } } : {};
    });

  const patchNode = (threadId: string, id: string, fn: (n: MessageNode) => MessageNode) =>
    patchData(threadId, (d) => (d.nodes[id] ? { nodes: { ...d.nodes, [id]: fn(d.nodes[id]) } } : {}));

  const currentLeaf = (threadId: string): string | null => {
    const d = get().data[threadId];
    if (!d) return null;
    return activePath(d.nodes, buildChildIndex(d.nodes), d.leafId).at(-1)?.id ?? null;
  };

  const applyTitle = (threadId: string, title: string) =>
    set((s) => ({
      threads: s.threads.map((t) => (t.id === threadId ? { ...t, title } : t)),
      meta: s.meta[threadId] ? { ...s.meta, [threadId]: { ...s.meta[threadId], title } } : s.meta,
    }));

  const touchThread = (threadId: string) =>
    set((s) => {
      const t = s.threads.find((x) => x.id === threadId);
      if (!t) return {};
      const updated = { ...t, updated_at: new Date().toISOString() };
      return { threads: [updated, ...s.threads.filter((x) => x.id !== threadId)] };
    });

  async function createFromDraft(): Promise<string> {
    const { draft } = get();
    const thread = await api.createThread({
      system_prompt: draft.system_prompt.trim() || null,
      model: draft.model,
      enabled_tools: draft.enabled_tools,
    });
    set((s) => ({
      meta: { ...s.meta, [thread.id]: thread },
      data: { ...s.data, [thread.id]: { status: "ready", error: null, nodes: {}, leafId: null } },
      threads: [summary(thread), ...s.threads.filter((t) => t.id !== thread.id)],
    }));
    return thread.id;
  }

  /**
   * Consumes one SSE response and applies it to the thread.
   * Returns false if the server never acknowledged the request (optimistic changes are rolled back).
   */
  async function runStream(
    threadId: string,
    events: AsyncGenerator<StreamEvent>,
    controller: AbortController,
    opts: { tempId?: string; prevLeaf: string | null },
  ): Promise<boolean> {
    set({ streaming: { threadId, assistantId: null, controller } });
    sendInFlight = false;

    let started = false;
    let assistantId: string | null = null;

    // Token deltas are batched per animation frame so long answers don't re-render per token.
    const buffer = new Map<string, { content: string; reasoning: string }>();
    let frame = 0;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!buffer.size) return;
      const pending = new Map(buffer);
      buffer.clear();
      patchData(threadId, (d) => {
        const nodes = { ...d.nodes };
        for (const [id, b] of pending) {
          const n = nodes[id];
          if (!n) continue;
          nodes[id] = {
            ...n,
            content: n.content + b.content,
            reasoning: b.reasoning ? (n.reasoning ?? "") + b.reasoning : n.reasoning,
          };
        }
        return { nodes };
      });
    };
    const queue = (id: string, key: "content" | "reasoning", delta: string) => {
      const b = buffer.get(id) ?? { content: "", reasoning: "" };
      b[key] += delta;
      buffer.set(id, b);
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const rollback = () =>
      patchData(threadId, (d) => {
        const nodes = { ...d.nodes };
        if (opts.tempId) delete nodes[opts.tempId];
        return { nodes, leafId: opts.prevLeaf };
      });

    try {
      for await (const ev of events) {
        if (ev.event === "token") {
          queue(ev.data.message_id, "content", ev.data.delta);
          continue;
        }
        if (ev.event === "reasoning") {
          queue(ev.data.message_id, "reasoning", ev.data.delta);
          continue;
        }
        flush();

        switch (ev.event) {
          case "user_message": {
            const m = ev.data.message;
            started = true;
            patchData(threadId, (d) => {
              const nodes = { ...d.nodes };
              if (opts.tempId) delete nodes[opts.tempId];
              nodes[m.id] = m;
              return { nodes, leafId: m.id };
            });
            break;
          }
          case "assistant_start": {
            const m = ev.data.message;
            started = true;
            assistantId = m.id;
            patchData(threadId, (d) => ({ nodes: { ...d.nodes, [m.id]: m }, leafId: m.id }));
            set((s) => (s.streaming ? { streaming: { ...s.streaming, assistantId: m.id } } : {}));
            break;
          }
          case "tool_call": {
            const { message_id, tool_call } = ev.data;
            patchNode(threadId, message_id, (n) => ({
              ...n,
              tool_calls: n.tool_calls.some((t) => t.id === tool_call.id)
                ? n.tool_calls.map((t) => (t.id === tool_call.id ? tool_call : t))
                : [...n.tool_calls, tool_call],
            }));
            break;
          }
          case "tool_result": {
            const { message_id, tool_call_id, output, status } = ev.data;
            patchNode(threadId, message_id, (n) => ({
              ...n,
              tool_calls: n.tool_calls.map((t) => (t.id === tool_call_id ? { ...t, output, status } : t)),
            }));
            break;
          }
          case "sources":
            patchNode(threadId, ev.data.message_id, (n) => ({ ...n, sources: ev.data.sources }));
            break;
          case "title":
            applyTitle(ev.data.thread_id, ev.data.title);
            break;
          case "done": {
            const m = ev.data.message;
            patchData(threadId, (d) => ({ nodes: { ...d.nodes, [m.id]: m }, leafId: m.id }));
            break;
          }
          case "error": {
            const { message_id, detail } = ev.data;
            if (!message_id) throw new ApiError(500, detail);
            patchNode(threadId, message_id, (n) => ({ ...n, status: "error", error: detail }));
            break;
          }
        }
      }

      flush();
      if (!started) throw new ApiError(500, "The server closed the stream without responding.");
      if (assistantId) {
        patchNode(threadId, assistantId, (n) =>
          n.status === "streaming" ? { ...n, status: "error", error: "The response ended unexpectedly." } : n,
        );
      }
      return true;
    } catch (err) {
      flush();
      if (!started) {
        rollback();
        if (!isAbortError(err)) get().toast(errorText(err));
        return false;
      }
      if (assistantId) {
        const id = assistantId;
        patchNode(threadId, id, (n) =>
          n.status !== "streaming"
            ? n
            : isAbortError(err)
              ? { ...n, status: "stopped" }
              : { ...n, status: "error", error: errorText(err) },
        );
      } else if (!isAbortError(err)) {
        get().toast(errorText(err));
      }
      return true;
    } finally {
      sendInFlight = false;
      set((s) => (s.streaming?.controller === controller ? { streaming: null } : {}));
      touchThread(threadId);
    }
  }

  function startUserMessage(
    threadId: string,
    parentId: string | null,
    content: string,
    attachments: Attachment[],
    navigateAfter: boolean,
  ): Promise<boolean> {
    const prevLeaf = currentLeaf(threadId);
    const temp: MessageNode = {
      id: `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      thread_id: threadId,
      parent_id: parentId,
      role: "user",
      content,
      status: "complete",
      model: null,
      attachments,
      tool_calls: [],
      sources: [],
      reasoning: null,
      error: null,
      feedback: null,
      created_at: new Date().toISOString(),
    };
    patchData(threadId, (d) => ({ nodes: { ...d.nodes, [temp.id]: temp }, leafId: temp.id }));
    if (navigateAfter) navigate(`/c/${threadId}`);

    const controller = new AbortController();
    const events = api.sendMessage(
      threadId,
      { parent_id: parentId, content, attachment_ids: attachments.map((a) => a.id), ...get().options },
      controller.signal,
    );
    return runStream(threadId, events, controller, { tempId: temp.id, prevLeaf });
  }

  return {
    models: [],
    tools: [],
    threads: [],
    threadsCursor: null,
    threadsLoading: false,
    threadsLoaded: false,
    meta: {},
    data: {},
    streaming: null,
    draft: loadDraft(),
    options: loadOptions(),
    toasts: [],

    setOptions(patch) {
      set((s) => {
        const options = { ...s.options, ...patch };
        try {
          localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
        } catch {
          /* ignore */
        }
        return { options };
      });
    },

    async init() {
      if (initialized) return;
      initialized = true;

      const [models, tools] = await Promise.allSettled([api.listModels(), api.listTools(), get().loadThreads(true)]);
      if (models.status === "fulfilled") {
        set((s) => {
          const list = models.value;
          const valid = list.some((m) => m.id === s.draft.model);
          return { models: list, draft: valid ? s.draft : { ...s.draft, model: list[0]?.id ?? null } };
        });
      } else {
        console.warn("[init] GET /models failed:", models.reason);
      }
      if (tools.status === "fulfilled") set({ tools: tools.value });
      else console.warn("[init] GET /tools failed:", tools.reason);
    },

    async loadThreads(reset = false) {
      if (get().threadsLoading) return;
      set({ threadsLoading: true });
      try {
        const page = await api.listThreads({ limit: 30, cursor: reset ? null : get().threadsCursor });
        set((s) => {
          const base = reset ? [] : s.threads;
          const known = new Set(base.map((t) => t.id));
          return { threads: [...base, ...page.items.filter((t) => !known.has(t.id))], threadsCursor: page.next_cursor };
        });
      } catch (err) {
        get().toast(`Couldn't load conversations: ${errorText(err)}`);
      } finally {
        set({ threadsLoading: false, threadsLoaded: true });
      }
    },

    async openThread(threadId) {
      const existing = get().data[threadId];
      if (existing && existing.status !== "error") return;

      set((s) => ({ data: { ...s.data, [threadId]: { status: "loading", error: null, nodes: {}, leafId: null } } }));
      try {
        const [thread, tree] = await Promise.all([api.getThread(threadId), api.getMessages(threadId)]);
        const nodes = Object.fromEntries(tree.messages.map((m) => [m.id, m]));
        set((s) => ({
          meta: { ...s.meta, [threadId]: thread },
          data: {
            ...s.data,
            [threadId]: { status: "ready", error: null, nodes, leafId: tree.current_leaf_id ?? thread.current_leaf_id },
          },
        }));
      } catch (err) {
        const notFound = err instanceof ApiError && err.status === 404;
        set((s) => ({
          data: {
            ...s.data,
            [threadId]: {
              status: "error",
              error: notFound ? "This conversation doesn't exist or was deleted." : errorText(err),
              nodes: {},
              leafId: null,
            },
          },
        }));
      }
    },

    async ensureThread() {
      try {
        const id = await createFromDraft();
        navigate(`/c/${id}`);
        return id;
      } catch (err) {
        get().toast(errorText(err));
        throw err;
      }
    },

    async send(threadId, content, attachments) {
      if (isBusy()) return false;
      sendInFlight = true;
      let id = threadId;
      if (!id) {
        try {
          id = await createFromDraft();
        } catch (err) {
          sendInFlight = false;
          get().toast(errorText(err));
          return false;
        }
      }
      return startUserMessage(id, currentLeaf(id), content, attachments, threadId === null);
    },

    async edit(threadId, messageId, content) {
      const node = get().data[threadId]?.nodes[messageId];
      if (!node || isBusy()) return false;
      sendInFlight = true;
      return startUserMessage(threadId, node.parent_id, content, node.attachments, false);
    },

    async regenerate(threadId, assistantId) {
      const node = get().data[threadId]?.nodes[assistantId];
      if (!node?.parent_id || isBusy()) return;
      const prevLeaf = currentLeaf(threadId);
      // Hide the old answer right away; the new one arrives as its sibling.
      patchData(threadId, () => ({ leafId: node.parent_id }));
      const controller = new AbortController();
      const events = api.regenerate(threadId, assistantId, { ...get().options }, controller.signal);
      await runStream(threadId, events, controller, { prevLeaf });
    },

    stop() {
      const s = get().streaming;
      if (!s) return;
      if (s.assistantId) api.stopGeneration(s.threadId, s.assistantId).catch(() => {});
      s.controller.abort();
    },

    switchBranch(threadId, siblingId) {
      if (get().streaming?.threadId === threadId) return;
      const d = get().data[threadId];
      if (!d?.nodes[siblingId]) return;
      const leaf = newestLeaf(buildChildIndex(d.nodes), siblingId);
      patchData(threadId, () => ({ leafId: leaf }));
      api.updateThread(threadId, { current_leaf_id: leaf }).catch((err) => {
        console.warn("[switchBranch] failed to persist current_leaf_id:", err);
      });
    },

    async renameThread(threadId, title) {
      const next = title.trim();
      const prev = get().threads.find((t) => t.id === threadId)?.title;
      if (!next || next === prev) return;
      applyTitle(threadId, next);
      try {
        await api.updateThread(threadId, { title: next });
      } catch (err) {
        if (prev !== undefined) applyTitle(threadId, prev);
        get().toast(errorText(err));
      }
    },

    async deleteThread(threadId) {
      if (get().streaming?.threadId === threadId) get().stop();
      const prevThreads = get().threads;
      set((s) => {
        const data = { ...s.data };
        const meta = { ...s.meta };
        delete data[threadId];
        delete meta[threadId];
        return { threads: s.threads.filter((t) => t.id !== threadId), data, meta };
      });
      if (getRouteThreadId() === threadId) navigate("/", { replace: true });
      try {
        await api.deleteThread(threadId);
      } catch (err) {
        set({ threads: prevThreads });
        get().toast(errorText(err));
      }
    },

    async updateSettings(threadId, patch) {
      if (!threadId) {
        set((s) => {
          const draft: DraftSettings = {
            system_prompt: patch.system_prompt !== undefined ? (patch.system_prompt ?? "") : s.draft.system_prompt,
            model: patch.model !== undefined ? patch.model : s.draft.model,
            enabled_tools: patch.enabled_tools ?? s.draft.enabled_tools,
          };
          saveDraft(draft);
          return { draft };
        });
        return true;
      }

      const prev = get().meta[threadId];
      if (prev) set((s) => ({ meta: { ...s.meta, [threadId]: { ...prev, ...patch } } }));
      try {
        const updated = await api.updateThread(threadId, patch);
        set((s) => ({ meta: { ...s.meta, [threadId]: updated } }));
        return true;
      } catch (err) {
        if (prev) set((s) => ({ meta: { ...s.meta, [threadId]: prev } }));
        get().toast(errorText(err));
        return false;
      }
    },

    async setFeedback(threadId, messageId, rating) {
      const prev = get().data[threadId]?.nodes[messageId]?.feedback ?? null;
      patchNode(threadId, messageId, (n) => ({ ...n, feedback: rating }));
      try {
        await api.setFeedback(threadId, messageId, rating);
      } catch (err) {
        patchNode(threadId, messageId, (n) => ({ ...n, feedback: prev }));
        get().toast(errorText(err));
      }
    },

    toast(text, kind = "error") {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }));
      setTimeout(() => get().dismissToast(id), 5000);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});
