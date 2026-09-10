/**
 * In-browser fake backend that implements API_CONTRACT.md, so the UI can be built and
 * tested before FastAPI exists. State persists in localStorage. Enabled with VITE_USE_MOCK=true.
 *
 * Handy triggers:
 *   "weather" / "calculate" / "search"  -> tool call (if that tool is enabled in chat settings)
 *   "/error"                            -> simulated model failure mid-stream
 *   files > 100 KB                      -> "rag" (indexed); smaller files -> "inline" (full text)
 */
import { ApiError } from "./client";
import type {
  ChatApi,
  ChatFile,
  GenerationOptions,
  KnowledgeDocument,
  MessageNode,
  Model,
  Source,
  StreamEvent,
  Thread,
  Tool,
  ToolCall,
} from "./types";

const STORE_KEY = "mock-backend-v2";
/** The real backend should decide by extracted token count; the mock uses file size. */
const INLINE_LIMIT_BYTES = 100 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface DB {
  threads: Record<string, Thread>;
  messages: Record<string, MessageNode>;
  files: Record<string, ChatFile>;
  knowledge: Record<string, KnowledgeDocument>;
}

const MODELS: Model[] = [
  {
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B",
    description: "Fast thinking model",
    supports_tools: true,
    supports_reasoning: true,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    description: "Smarter thinking model, a bit slower",
    supports_tools: true,
    supports_reasoning: true,
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    description: "Non-thinking model",
    supports_tools: true,
    supports_reasoning: false,
  },
];

const TOOLS: Tool[] = [
  { name: "web_search", display_name: "Web search", description: "Search the web for up-to-date information" },
  { name: "calculator", display_name: "Calculator", description: "Evaluate arithmetic expressions" },
  { name: "get_weather", display_name: "Weather", description: "Current weather for a city" },
];

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

function load(): DB {
  try {
    localStorage.removeItem("mock-backend-v1");
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { threads: {}, messages: {}, files: {}, knowledge: {}, ...(JSON.parse(raw) as Partial<DB>) };
  } catch {
    /* ignore */
  }
  return exampleData();
}

/** First-run sample so the UI opens showing branching, reasoning and knowledge-base sources. */
function exampleData(): DB {
  const start = Date.now() - 42 * 60 * 1000;
  const at = (minutes: number) => new Date(start + minutes * 60 * 1000).toISOString();
  const threadId = "example-thread";
  const model = "openai/gpt-oss-20b";

  const kb: KnowledgeDocument = {
    id: "example-kb-refunds",
    filename: "refund-policy.pdf",
    mime_type: "application/pdf",
    size_bytes: 482_113,
    status: "ready",
    chunk_count: 96,
    error: null,
    created_at: at(0),
  };
  const policySource: Source = {
    origin: "knowledge_base",
    file_id: kb.id,
    filename: kb.filename,
    chunk_id: `${kb.id}:14`,
    snippet:
      "Annual subscriptions cancelled within 30 days of the purchase date are eligible for a full refund. " +
      "After 30 days, refunds are prorated by unused months, less a 10% processing fee. No refunds after 6 months.",
    score: 0.87,
    page: 3,
  };

  const msg = (m: Partial<MessageNode> & Pick<MessageNode, "id" | "parent_id" | "role">): MessageNode => ({
    ...newNode({ thread_id: threadId, parent_id: m.parent_id, role: m.role }),
    ...m,
  });

  const messages = [
    msg({ id: "ex-u1", parent_id: null, role: "user", created_at: at(1), content: "What's our refund window for annual plans?" }),
    msg({
      id: "ex-a1",
      parent_id: "ex-u1",
      role: "assistant",
      model,
      created_at: at(2),
      reasoning: "Question is about annual plans. Knowledge base mode is on, so only use the retrieved policy chunk.",
      sources: [policySource],
      content:
        "Annual plans get a **full refund within 30 days** of purchase [1]. After that, refunds are prorated by unused " +
        "months, minus a 10% processing fee, and stop entirely after 6 months [1].\n\n" +
        "| Time since purchase | Refund |\n|---|---|\n| 0–30 days | 100% |\n| 31 days – 6 months | Prorated, minus 10% |\n| After 6 months | None |",
    }),
    msg({
      id: "ex-u2",
      parent_id: "ex-a1",
      role: "user",
      created_at: at(5),
      content: "Draft a reply to a customer asking for a refund after 45 days.",
    }),
    msg({
      id: "ex-a2",
      parent_id: "ex-u2",
      role: "assistant",
      model,
      created_at: at(6),
      content:
        "Hi there,\n\nThanks for reaching out. Because your annual plan was purchased 45 days ago, it's outside the " +
        "30-day full-refund window. You're still eligible for a prorated refund for the unused months, less a 10% " +
        "processing fee. Reply to confirm and we'll process it within 5 business days.\n\nBest,\nSupport team",
    }),
    msg({
      id: "ex-u2b",
      parent_id: "ex-a1",
      role: "user",
      created_at: at(8),
      content: "Draft a short, friendly reply to a customer asking for a refund after 45 days. Keep it under 60 words.",
    }),
    msg({
      id: "ex-a2b",
      parent_id: "ex-u2b",
      role: "assistant",
      model,
      created_at: at(9),
      feedback: "up",
      reasoning: "Keep it under 60 words; mention prorated refund and the fee.",
      content:
        "Hi! Thanks for getting in touch. Your plan is 45 days old, so a full refund isn't available, but we can " +
        "refund your unused months (minus a 10% fee). Just reply **yes** and it'll be done within 5 business days. 😊",
    }),
  ];

  const thread: Thread = {
    id: threadId,
    title: "Example: annual refund policy",
    system_prompt: "You are a concise, friendly support assistant.",
    model,
    enabled_tools: [],
    current_leaf_id: "ex-a2b",
    created_at: at(0),
    updated_at: at(9),
  };

  return {
    threads: { [thread.id]: thread },
    messages: Object.fromEntries(messages.map((m) => [m.id, m])),
    files: {},
    knowledge: { [kb.id]: kb },
  };
}

const db: DB = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    /* quota or privacy mode: keep in memory only */
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function requireThread(id: string): Thread {
  const t = db.threads[id];
  if (!t) throw new ApiError(404, "Thread not found");
  return t;
}

function newNode(partial: Pick<MessageNode, "thread_id" | "parent_id" | "role"> & Partial<MessageNode>): MessageNode {
  return {
    id: uuid(),
    content: "",
    status: "complete",
    model: null,
    attachments: [],
    tool_calls: [],
    sources: [],
    reasoning: null,
    error: null,
    feedback: null,
    created_at: now(),
    ...partial,
  };
}

function chunks(text: string): string[] {
  // Word-ish chunks, like an LLM token stream.
  return text.match(/\s*\S{1,6}|\s+/g) ?? [text];
}

/** Ready chat files attached to messages on the path root → `from` (never other branches). */
function filesOnPath(from: MessageNode): ChatFile[] {
  const out: ChatFile[] = [];
  let current: MessageNode | undefined = from;
  while (current) {
    for (const a of current.attachments) {
      const f = db.files[a.id];
      if (f?.status === "ready") out.push(f);
    }
    current = current.parent_id ? db.messages[current.parent_id] : undefined;
  }
  return out;
}

function pickTool(content: string, enabled: string[]): ToolCall | null {
  const text = content.toLowerCase();
  const make = (name: string, args: Record<string, unknown>): ToolCall => ({
    id: `call_${uuid().slice(0, 8)}`,
    name,
    arguments: args,
    output: null,
    status: "running",
  });
  if (enabled.includes("get_weather") && text.includes("weather")) {
    const city = content.match(/in ([A-Z][a-zA-Z]+)/)?.[1] ?? "Delhi";
    return make("get_weather", { city });
  }
  if (enabled.includes("calculator") && /calc|\d+\s*[-+*/]\s*\d+/.test(text)) {
    const expr = content.match(/[\d\s.+\-*/()]{3,}/)?.[0]?.trim() ?? "2 + 2";
    return make("calculator", { expression: expr });
  }
  if (enabled.includes("web_search") && /search|latest|news/.test(text)) {
    return make("web_search", { query: content.slice(0, 80) });
  }
  return null;
}

function runTool(call: ToolCall): string {
  switch (call.name) {
    case "get_weather":
      return JSON.stringify({ city: call.arguments.city, temp_c: 31, condition: "Partly cloudy", humidity: 0.62 });
    case "calculator": {
      const expr = String(call.arguments.expression);
      if (!/^[\d\s.+\-*/()]+$/.test(expr)) return "error: invalid expression";
      try {
        return String(Function(`"use strict";return (${expr})`)());
      } catch {
        return "error: invalid expression";
      }
    }
    default:
      return JSON.stringify([
        { title: "Mock search result #1", url: "https://example.com/1" },
        { title: "Mock search result #2", url: "https://example.com/2" },
      ]);
  }
}

function makeSources(
  origin: Source["origin"],
  files: Array<{ id: string; filename: string }>,
  offset: number,
): Source[] {
  return files.slice(0, 3).map((f, i) => ({
    origin,
    file_id: f.id,
    filename: f.filename,
    chunk_id: `${f.id}:${i}`,
    snippet: `…a relevant passage retrieved from ${f.filename} would appear here…`,
    score: Math.round((0.91 - (offset + i) * 0.06) * 100) / 100,
    page: i + 1,
  }));
}

interface ReplyContext {
  thread: Thread;
  user: MessageNode;
  tool: ToolCall | null;
  sources: Source[];
  inlineFiles: ChatFile[];
  strict: boolean;
}

function cite(sources: Source[], origin: Source["origin"]): string {
  return sources.flatMap((s, i) => (s.origin === origin ? [`[${i + 1}]`] : [])).join("");
}

function buildReply({ thread, user, tool, sources, inlineFiles, strict }: ReplyContext): string {
  if (strict && sources.length === 0 && inlineFiles.length === 0) {
    return (
      "I couldn't find anything relevant in the **knowledge base**, so I can't answer this in Knowledge base mode.\n\n" +
      "Add documents from **Knowledge base** in the sidebar, or turn the mode off to chat normally."
    );
  }

  const quote = user.content.length > 200 ? `${user.content.slice(0, 200)}…` : user.content;
  const parts: string[] = ["This is a **mock response** from the in-browser test backend. No model was called."];

  if (strict) parts.push("_Knowledge base mode: answering only from retrieved documents._");
  if (thread.system_prompt) parts.push(`_System prompt in effect:_ "${thread.system_prompt.slice(0, 120)}"`);
  parts.push(`You said:\n\n> ${quote.replace(/\n/g, "\n> ")}`);

  if (inlineFiles.length) {
    const names = inlineFiles.map((f) => `\`${f.filename}\``).join(", ");
    parts.push(`I read the full text of ${names}. It's small, so no retrieval was needed.`);
  }
  if (sources.some((s) => s.origin === "knowledge_base")) {
    parts.push(`According to your knowledge base ${cite(sources, "knowledge_base")}, this is where the grounded answer goes.`);
  }
  if (sources.some((s) => s.origin === "attachment")) {
    parts.push(
      `From the indexed chat file ${cite(sources, "attachment")}: the relevant chunks were retrieved from this thread's vectors, with no re-indexing.`,
    );
  }
  if (tool) {
    parts.push(`I called the \`${tool.name}\` tool, which returned:\n\n\`\`\`json\n${tool.output}\n\`\`\``);
  }

  if (strict) return parts.join("\n\n");

  if (/code|python|function|script|example/i.test(user.content)) {
    parts.push(
      "Here's a small example:\n\n```python\ndef fibonacci(n: int) -> list[int]:\n    seq = [0, 1]\n" +
        "    while len(seq) < n:\n        seq.append(seq[-1] + seq[-2])\n    return seq[:n]\n\n" +
        "print(fibonacci(10))\n```",
    );
  } else {
    parts.push(
      "Things you can try in mock mode:\n\n" +
        "| Try | What happens |\n|---|---|\n" +
        "| Edit this message | Creates a new branch (`‹ 1/2 ›`) |\n" +
        "| Toggle **Think** | Reasoning trace on/off |\n" +
        "| Toggle **Knowledge base** | Answers only from knowledge-base documents |\n" +
        "| Attach a file < 100 KB | Read in full (inline) |\n" +
        "| Attach a file > 100 KB | Indexed once, then retrieved (RAG) |\n" +
        '| Enable tools, ask "weather in Paris" | Tool call card |\n' +
        "| Send `/error` | Error state with retry |",
    );
  }
  return parts.join("\n\n");
}

async function* generate(
  thread: Thread,
  user: MessageNode,
  options: GenerationOptions,
  signal: AbortSignal,
  modelOverride?: string | null,
): AsyncGenerator<StreamEvent> {
  const model = MODELS.find((m) => m.id === (modelOverride ?? thread.model)) ?? MODELS[0];
  const strict = options.knowledge_mode === "strict";
  const asst = newNode({
    thread_id: thread.id,
    parent_id: user.id,
    role: "assistant",
    status: "streaming",
    model: model.id,
  });
  db.messages[asst.id] = asst;
  thread.current_leaf_id = asst.id;
  thread.updated_at = now();
  save();

  yield { event: "assistant_start", data: { message: clone(asst) } };

  try {
    await sleep(250, signal);

    if (model.supports_reasoning && options.think) {
      const thought = `The user wrote about "${user.content.slice(0, 60)}". ${
        strict ? "Knowledge base mode is on, so I must only use retrieved documents." : "I should answer clearly."
      }`;
      for (const c of chunks(thought)) {
        await sleep(12, signal);
        asst.reasoning = (asst.reasoning ?? "") + c;
        yield { event: "reasoning", data: { message_id: asst.id, delta: c } };
      }
    }

    // Tools that bring outside knowledge don't fit knowledge-only answers.
    const call = strict ? null : pickTool(user.content, thread.enabled_tools);
    if (call) {
      asst.tool_calls.push(call);
      yield { event: "tool_call", data: { message_id: asst.id, tool_call: clone(call) } };
      await sleep(800, signal);
      call.output = runTool(call);
      call.status = call.output.startsWith("error") ? "error" : "success";
      yield {
        event: "tool_result",
        data: { message_id: asst.id, tool_call_id: call.id, output: call.output, status: call.status },
      };
    }

    const pathFiles = filesOnPath(user);
    const ragFiles = pathFiles.filter((f) => f.processing === "rag");
    const inlineFiles = pathFiles.filter((f) => f.processing === "inline");
    const kbDocs = strict ? Object.values(db.knowledge).filter((d) => d.status === "ready") : [];

    const kbSources = makeSources("knowledge_base", kbDocs, 0);
    asst.sources = [...kbSources, ...makeSources("attachment", ragFiles, kbSources.length)];
    if (asst.sources.length) {
      await sleep(300, signal);
      yield { event: "sources", data: { message_id: asst.id, sources: clone(asst.sources) } };
    }

    const reply = buildReply({ thread, user, tool: call, sources: asst.sources, inlineFiles, strict });
    const fail = user.content.includes("/error");
    const pieces = chunks(reply);
    for (let i = 0; i < pieces.length; i++) {
      if (fail && i === 12) {
        asst.status = "error";
        asst.error = "Simulated model failure (you sent /error).";
        save();
        yield { event: "error", data: { message_id: asst.id, detail: asst.error } };
        return;
      }
      await sleep(10 + Math.random() * 25, signal);
      asst.content += pieces[i];
      yield { event: "token", data: { message_id: asst.id, delta: pieces[i] } };
    }

    asst.status = "complete";
    if (thread.title === "New chat") {
      thread.title = user.content.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ") || "New chat";
      yield { event: "title", data: { thread_id: thread.id, title: thread.title } };
    }
    save();
    yield { event: "done", data: { message: clone(asst) } };
  } finally {
    // Client aborted or stopped iterating: keep partial output, like the real backend should.
    if (asst.status === "streaming") {
      asst.status = "stopped";
      save();
    }
  }
}

function finishProcessing<T extends { status: string }>(record: T, delay: number, apply: (r: T) => void) {
  setTimeout(() => {
    if (record.status !== "processing") return;
    apply(record);
    save();
  }, delay);
}

export const mockApi: ChatApi = {
  mode: "mock",

  async health() {
    return { status: "ok" };
  },
  async listModels() {
    await sleep(80);
    return clone(MODELS);
  },
  async listTools() {
    await sleep(80);
    return clone(TOOLS);
  },

  async listThreads({ limit = 30, cursor = null, q } = {}) {
    await sleep(120);
    let items = Object.values(db.threads).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (q) items = items.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
    const offset = cursor ? Number(cursor) : 0;
    const page = items.slice(offset, offset + limit);
    return {
      items: page.map(({ id, title, created_at, updated_at }) => ({ id, title, created_at, updated_at })),
      next_cursor: offset + limit < items.length ? String(offset + limit) : null,
    };
  },

  async createThread(body) {
    await sleep(100);
    if (body.model && !MODELS.some((m) => m.id === body.model)) throw new ApiError(422, "model: unknown model");
    const t: Thread = {
      id: uuid(),
      title: body.title?.trim() || "New chat",
      system_prompt: body.system_prompt ?? null,
      model: body.model ?? MODELS[0].id,
      enabled_tools: body.enabled_tools ?? [],
      current_leaf_id: null,
      created_at: now(),
      updated_at: now(),
    };
    db.threads[t.id] = t;
    save();
    return clone(t);
  },

  async getThread(id) {
    await sleep(60);
    return clone(requireThread(id));
  },

  async updateThread(id, body) {
    await sleep(60);
    const t = requireThread(id);
    if (body.current_leaf_id && db.messages[body.current_leaf_id]?.thread_id !== id) {
      throw new ApiError(422, "current_leaf_id: message not in this thread");
    }
    Object.assign(t, body);
    save();
    return clone(t);
  },

  async deleteThread(id) {
    await sleep(80);
    requireThread(id);
    delete db.threads[id];
    for (const m of Object.values(db.messages)) if (m.thread_id === id) delete db.messages[m.id];
    for (const f of Object.values(db.files)) if (f.thread_id === id) delete db.files[f.id];
    save();
  },

  async getMessages(id) {
    await sleep(150);
    const t = requireThread(id);
    return {
      thread_id: id,
      current_leaf_id: t.current_leaf_id,
      messages: clone(Object.values(db.messages).filter((m) => m.thread_id === id)),
    };
  },

  async *sendMessage(threadId, body, signal) {
    await sleep(150, signal);
    const thread = requireThread(threadId);
    if (!body.content.trim()) throw new ApiError(422, "content: must not be empty");
    if (body.parent_id && db.messages[body.parent_id]?.thread_id !== threadId) {
      throw new ApiError(422, "parent_id: message not in this thread");
    }
    const files = body.attachment_ids.map((id) => {
      const f = db.files[id];
      if (!f || f.thread_id !== threadId) throw new ApiError(422, `attachment_ids: file ${id} not found in this thread`);
      if (f.status !== "ready" || !f.processing) throw new ApiError(422, `attachment_ids: ${f.filename} is not ready`);
      return f;
    });

    const user = newNode({
      thread_id: threadId,
      parent_id: body.parent_id,
      role: "user",
      content: body.content,
      attachments: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        processing: f.processing!,
      })),
    });
    db.messages[user.id] = user;
    for (const f of files) f.message_id ??= user.id;
    thread.current_leaf_id = user.id;
    save();

    yield { event: "user_message", data: { message: clone(user) } };
    yield* generate(thread, user, body, signal);
  },

  async *regenerate(threadId, messageId, body, signal) {
    await sleep(150, signal);
    const thread = requireThread(threadId);
    const target = db.messages[messageId];
    if (!target || target.thread_id !== threadId || target.role !== "assistant" || !target.parent_id) {
      throw new ApiError(404, "Assistant message not found");
    }
    yield* generate(thread, db.messages[target.parent_id], body, signal, body.model);
  },

  async stopGeneration(threadId) {
    for (const m of Object.values(db.messages)) {
      if (m.thread_id === threadId && m.status === "streaming") m.status = "stopped";
    }
    save();
  },

  async setFeedback(threadId, messageId, rating) {
    await sleep(60);
    const m = db.messages[messageId];
    if (!m || m.thread_id !== threadId) throw new ApiError(404, "Message not found");
    m.feedback = rating;
    save();
    return clone(m);
  },

  // ---- chat files (thread-scoped) ----

  async uploadChatFile(threadId, file) {
    await sleep(400);
    requireThread(threadId);
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "File too large (max 50 MB)");
    const large = file.size > INLINE_LIMIT_BYTES;
    const record: ChatFile = {
      id: uuid(),
      thread_id: threadId,
      message_id: null,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      processing: null,
      status: "processing",
      token_count: null,
      chunk_count: null,
      error: null,
      created_at: now(),
    };
    db.files[record.id] = record;
    save();

    // Extraction decides the mode quickly; indexing large files takes longer.
    setTimeout(() => {
      const f = db.files[record.id];
      if (!f) return;
      f.processing = large ? "rag" : "inline";
      f.token_count = Math.max(1, Math.round(file.size / 4));
      save();
    }, 500);
    finishProcessing(record, large ? 3000 : 900, (f) => {
      const live = db.files[f.id];
      if (!live) return;
      live.status = "ready";
      live.processing ??= large ? "rag" : "inline";
      live.token_count ??= Math.max(1, Math.round(file.size / 4));
      if (large) live.chunk_count = Math.max(1, Math.round((live.token_count ?? 0) / 500));
    });
    return clone(record);
  },

  async listChatFiles(threadId) {
    await sleep(80);
    requireThread(threadId);
    return clone(
      Object.values(db.files)
        .filter((f) => f.thread_id === threadId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    );
  },

  async getChatFile(threadId, fileId) {
    await sleep(60);
    const f = db.files[fileId];
    if (!f || f.thread_id !== threadId) throw new ApiError(404, "File not found");
    return clone(f);
  },

  async deleteChatFile(threadId, fileId) {
    await sleep(60);
    const f = db.files[fileId];
    if (!f || f.thread_id !== threadId) throw new ApiError(404, "File not found");
    delete db.files[fileId];
    save();
  },

  // ---- global knowledge base ----

  async listKnowledge() {
    await sleep(80);
    return clone(Object.values(db.knowledge).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  },

  async uploadKnowledge(file) {
    await sleep(400);
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(413, "File too large (max 50 MB)");
    const doc: KnowledgeDocument = {
      id: uuid(),
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      status: "processing",
      chunk_count: null,
      error: null,
      created_at: now(),
    };
    db.knowledge[doc.id] = doc;
    save();
    finishProcessing(doc, 2000, (d) => {
      const live = db.knowledge[d.id];
      if (!live) return;
      live.status = "ready";
      live.chunk_count = Math.max(1, Math.round(file.size / 2000));
    });
    return clone(doc);
  },

  async getKnowledge(id) {
    await sleep(60);
    const d = db.knowledge[id];
    if (!d) throw new ApiError(404, "Document not found");
    return clone(d);
  },

  async deleteKnowledge(id) {
    await sleep(60);
    if (!db.knowledge[id]) throw new ApiError(404, "Document not found");
    delete db.knowledge[id];
    save();
  },
};
