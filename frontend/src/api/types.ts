// TypeScript mirror of API_CONTRACT.md. Keep the two in sync.

export type ISODate = string;

export interface Model {
  id: string;
  name: string;
  description: string | null;
  supports_tools: boolean;
  /** Thinking model: the UI shows the Think toggle. */
  supports_reasoning: boolean;
}

export interface Tool {
  name: string;
  display_name: string;
  description: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface Thread extends ThreadSummary {
  system_prompt: string | null;
  model: string | null;
  enabled_tools: string[];
  current_leaf_id: string | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export type Role = "user" | "assistant";
export type MessageStatus = "streaming" | "complete" | "stopped" | "error";
export type Feedback = "up" | "down" | null;

/** How the backend feeds an attached file to the model. */
export type ProcessingMode = "inline" | "rag";

/** A chat file as referenced from a user message. */
export interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  processing: ProcessingMode;
}

export type ToolCallStatus = "running" | "success" | "error";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  output: string | null;
  status: ToolCallStatus;
}

export type SourceOrigin = "knowledge_base" | "attachment";

export interface Source {
  origin: SourceOrigin;
  /** KnowledgeDocument.id or ChatFile.id, depending on origin. */
  file_id: string;
  filename: string;
  chunk_id: string;
  snippet: string;
  score: number | null;
  page: number | null;
}

export interface MessageNode {
  id: string;
  thread_id: string;
  parent_id: string | null;
  role: Role;
  content: string;
  status: MessageStatus;
  model: string | null;
  attachments: Attachment[];
  tool_calls: ToolCall[];
  sources: Source[];
  reasoning: string | null;
  error: string | null;
  feedback: Feedback;
  created_at: ISODate;
}

export interface MessageTree {
  thread_id: string;
  current_leaf_id: string | null;
  messages: MessageNode[];
}

export type FileStatus = "processing" | "ready" | "failed";

/** A file uploaded into one thread (temporary, thread-scoped RAG or inline context). */
export interface ChatFile {
  id: string;
  thread_id: string;
  /** User message it was sent with; null while it's only staged in the composer. */
  message_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** null until the backend has extracted the text and decided. */
  processing: ProcessingMode | null;
  status: FileStatus;
  token_count: number | null;
  chunk_count: number | null;
  error: string | null;
  created_at: ISODate;
}

/** A document in the global knowledge base (persistent vector store). */
export interface KnowledgeDocument {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: FileStatus;
  chunk_count: number | null;
  error: string | null;
  created_at: ISODate;
}

// ---------- request bodies ----------

export interface CreateThreadBody {
  title?: string;
  system_prompt?: string | null;
  model?: string | null;
  enabled_tools?: string[];
}

export type UpdateThreadBody = Partial<
  Pick<Thread, "title" | "system_prompt" | "model" | "enabled_tools" | "current_leaf_id">
>;

export type KnowledgeMode = "off" | "strict";

/** Per-request switches chosen in the composer. */
export interface GenerationOptions {
  think: boolean;
  knowledge_mode: KnowledgeMode;
}

export interface SendMessageBody extends GenerationOptions {
  parent_id: string | null;
  content: string;
  attachment_ids: string[];
}

export interface RegenerateBody extends GenerationOptions {
  model?: string | null;
}

// ---------- streaming events (SSE) ----------

export type StreamEvent =
  | { event: "user_message"; data: { message: MessageNode } }
  | { event: "assistant_start"; data: { message: MessageNode } }
  | { event: "token"; data: { message_id: string; delta: string } }
  | { event: "reasoning"; data: { message_id: string; delta: string } }
  | { event: "tool_call"; data: { message_id: string; tool_call: ToolCall } }
  | {
      event: "tool_result";
      data: { message_id: string; tool_call_id: string; output: string; status: "success" | "error" };
    }
  | { event: "sources"; data: { message_id: string; sources: Source[] } }
  | { event: "title"; data: { thread_id: string; title: string } }
  | { event: "done"; data: { message: MessageNode } }
  | { event: "error"; data: { message_id: string | null; detail: string } };

// ---------- the interface both the real client and the mock implement ----------

export interface ChatApi {
  readonly mode: "live" | "mock";
  health(): Promise<{ status: string }>;
  listModels(): Promise<Model[]>;
  listTools(): Promise<Tool[]>;

  listThreads(params?: { limit?: number; cursor?: string | null; q?: string }): Promise<Page<ThreadSummary>>;
  createThread(body: CreateThreadBody): Promise<Thread>;
  getThread(threadId: string): Promise<Thread>;
  updateThread(threadId: string, body: UpdateThreadBody): Promise<Thread>;
  deleteThread(threadId: string): Promise<void>;

  getMessages(threadId: string): Promise<MessageTree>;
  sendMessage(threadId: string, body: SendMessageBody, signal: AbortSignal): AsyncGenerator<StreamEvent>;
  regenerate(
    threadId: string,
    messageId: string,
    body: RegenerateBody,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent>;
  stopGeneration(threadId: string, messageId: string): Promise<void>;
  setFeedback(threadId: string, messageId: string, rating: Feedback): Promise<MessageNode>;

  uploadChatFile(threadId: string, file: File): Promise<ChatFile>;
  listChatFiles(threadId: string): Promise<ChatFile[]>;
  getChatFile(threadId: string, fileId: string): Promise<ChatFile>;
  deleteChatFile(threadId: string, fileId: string): Promise<void>;

  listKnowledge(): Promise<KnowledgeDocument[]>;
  uploadKnowledge(file: File): Promise<KnowledgeDocument>;
  getKnowledge(documentId: string): Promise<KnowledgeDocument>;
  deleteKnowledge(documentId: string): Promise<void>;
}
