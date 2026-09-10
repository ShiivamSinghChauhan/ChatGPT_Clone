import { parseSSE } from "./sse";
import type {
  ChatApi,
  ChatFile,
  CreateThreadBody,
  Feedback,
  KnowledgeDocument,
  MessageNode,
  MessageTree,
  Model,
  Page,
  RegenerateBody,
  SendMessageBody,
  StreamEvent,
  Thread,
  ThreadSummary,
  Tool,
  UpdateThreadBody,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Turns FastAPI's `{"detail": ...}` (string or 422 validation list) into a readable message. */
function detailToMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((e: { loc?: unknown[]; msg?: string }) => {
          const loc = Array.isArray(e?.loc) ? e.loc.filter((p) => p !== "body").join(".") : "";
          return loc ? `${loc}: ${e?.msg}` : (e?.msg ?? JSON.stringify(e));
        })
        .join("; ");
    }
  }
  return fallback;
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  throw new ApiError(res.status, detailToMessage(body, `${res.status} ${res.statusText || "Request failed"}`), body);
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(BASE + path, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(0, "Can't reach the server. Is the backend running?");
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await doFetch(path, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  await ensureOk(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function* stream(path: string, body: unknown, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const res = await doFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  await ensureOk(res);
  if (!res.body) throw new ApiError(res.status, "The server returned an empty stream.");
  yield* parseSSE(res.body);
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

export const liveApi: ChatApi = {
  mode: "live",

  health: () => request("/health"),
  listModels: () => request<Model[]>("/models"),
  listTools: () => request<Tool[]>("/tools"),

  listThreads: (params = {}) =>
    request<Page<ThreadSummary>>(`/threads${qs({ limit: params.limit, cursor: params.cursor, q: params.q })}`),
  createThread: (body: CreateThreadBody) => request<Thread>("/threads", { method: "POST", json: body }),
  getThread: (id) => request<Thread>(`/threads/${enc(id)}`),
  updateThread: (id, body: UpdateThreadBody) => request<Thread>(`/threads/${enc(id)}`, { method: "PATCH", json: body }),
  deleteThread: (id) => request<void>(`/threads/${enc(id)}`, { method: "DELETE" }),

  getMessages: (id) => request<MessageTree>(`/threads/${enc(id)}/messages`),
  sendMessage: (id, body: SendMessageBody, signal) => stream(`/threads/${enc(id)}/messages`, body, signal),
  regenerate: (id, messageId, body: RegenerateBody, signal) =>
    stream(`/threads/${enc(id)}/messages/${enc(messageId)}/regenerate`, body, signal),
  stopGeneration: (id, messageId) =>
    request<void>(`/threads/${enc(id)}/messages/${enc(messageId)}/stop`, { method: "POST" }),
  setFeedback: (id, messageId, rating: Feedback) =>
    request<MessageNode>(`/threads/${enc(id)}/messages/${enc(messageId)}/feedback`, {
      method: "PUT",
      json: { rating },
    }),

  uploadChatFile: (threadId, file) =>
    request<ChatFile>(`/threads/${enc(threadId)}/files`, { method: "POST", body: fileForm(file) }),
  listChatFiles: (threadId) => request<ChatFile[]>(`/threads/${enc(threadId)}/files`),
  getChatFile: (threadId, fileId) => request<ChatFile>(`/threads/${enc(threadId)}/files/${enc(fileId)}`),
  deleteChatFile: (threadId, fileId) =>
    request<void>(`/threads/${enc(threadId)}/files/${enc(fileId)}`, { method: "DELETE" }),

  listKnowledge: () => request<KnowledgeDocument[]>("/knowledge-base/documents"),
  uploadKnowledge: (file) =>
    request<KnowledgeDocument>("/knowledge-base/documents", { method: "POST", body: fileForm(file) }),
  getKnowledge: (id) => request<KnowledgeDocument>(`/knowledge-base/documents/${enc(id)}`),
  deleteKnowledge: (id) => request<void>(`/knowledge-base/documents/${enc(id)}`, { method: "DELETE" }),
};

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}
