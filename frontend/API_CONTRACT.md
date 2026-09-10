# Chat API Contract (Frontend ⇄ FastAPI)

This is the agreement between the React frontend (`./frontend`) and the FastAPI backend.
**Backend owner:** AI engineer (validation, persistence, LangGraph, RAG, tools).
**Frontend owner:** me (everything under `./frontend`).

The frontend is already built against this document. `src/api/types.ts` is the TypeScript mirror of it,
and `src/api/mock.ts` is a working in-browser reference implementation. If something here is unclear, the mock
shows the exact behaviour the UI expects.

> Want to change a shape or add a field? Tell me first. I'll update this file, `types.ts` and the mock together.

---

## Contents

1. [Conventions](#1-conventions)
2. [Features at a glance](#2-features-at-a-glance)
3. [Data models](#3-data-models)
4. [How branching works](#4-how-branching-works)
5. [Think & Knowledge base mode](#5-think--knowledge-base-mode)
6. [Files: chat files vs. knowledge base](#6-files-chat-files-vs-knowledge-base)
7. [Endpoints](#7-endpoints)
8. [Streaming protocol (SSE)](#8-streaming-protocol-sse)
9. [Errors](#9-errors)
10. [CORS & local dev](#10-cors--local-dev)
11. [Implementation checklist](#11-implementation-checklist)
12. [Open questions for the AI engineer](#12-open-questions-for-the-ai-engineer)

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | Everything is under **`/api`** (e.g. `GET /api/threads`). Use an `APIRouter(prefix="/api")`. |
| Format | JSON request/response bodies, `snake_case` fields. Uploads use `multipart/form-data` with a single `file` part. |
| IDs | Strings. UUID4 recommended. The frontend never parses them. |
| Timestamps | ISO-8601 **with timezone**, UTC, e.g. `"2026-09-10T14:03:22.512Z"` or `"...+00:00"`. |
| Nullability | Every field listed below is always **present**. When there's no value, send `null` (or `[]` for lists). Don't omit keys. |
| Priority | **P0** = needed for basic chat. **P1** = needed for the full feature set. **P2** = nice to have. The UI degrades gracefully while P1/P2 endpoints are missing. |

---

## 2. Features at a glance

| Feature | UI | Contract |
|---|---|---|
| Multi-thread chats | Sidebar | Threads CRUD |
| Edit any message → new branch | ✏️ on a user message, `‹ 2/3 ›` switcher | `parent_id` tree, §4 |
| Regenerate | 🔄 on an answer | regenerate endpoint |
| System prompt, tools | Chat settings dialog | `Thread.system_prompt`, `Thread.enabled_tools` |
| **Think** on/off | 💡 Think toggle in the message box (thinking models only) | `think` in send/regenerate body, §5 |
| **Knowledge base mode** (global RAG, strict) | 📚 Knowledge base toggle + Knowledge base screen | `knowledge_mode` in body, knowledge-base endpoints, §5–6 |
| **Chat files** (temporary, thread-scoped RAG) | 📎 in the message box | chat file endpoints, `attachment_ids`, §6 |
| Streaming, stop | Live tokens, ■ button | SSE §8, stop endpoint |

---

## 3. Data models

### Model
Returned by `GET /api/models`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Value sent back in `Thread.model`, e.g. `"openai/gpt-oss-20b"` |
| `name` | string | Display name, e.g. `"GPT-OSS 20B"` |
| `description` | string \| null | One-line hint shown in the model picker |
| `supports_tools` | bool | If false, the tool toggles are disabled for this model |
| `supports_reasoning` | bool | **Thinking model.** If true, the UI shows the **Think** toggle |

### Tool
Returned by `GET /api/tools`.

| Field | Type | Notes |
|---|---|---|
| `name` | string | Stable identifier, e.g. `"web_search"`. Used in `Thread.enabled_tools` and `ToolCall.name` |
| `display_name` | string | e.g. `"Web search"` |
| `description` | string | Shown under the toggle |

### ThreadSummary
Sidebar list item.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `title` | string | `"New chat"` until a title is generated/renamed |
| `created_at` | datetime | |
| `updated_at` | datetime | **Bump when messages are added.** The sidebar sorts and groups by it. Do *not* bump on `PATCH` of `current_leaf_id`. |

### Thread
`ThreadSummary` plus:

| Field | Type | Notes |
|---|---|---|
| `system_prompt` | string \| null | Applied to every generation in this thread |
| `model` | string \| null | `null` means "backend default" |
| `enabled_tools` | string[] | Tool `name`s the model may call in this thread. `[]` means no tools |
| `current_leaf_id` | string \| null | The message at the tip of the branch the user is currently viewing (see §4) |

### MessageNode
One node in the conversation tree.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `thread_id` | string | |
| `parent_id` | string \| null | `null` only for the first message(s) of a thread |
| `role` | `"user"` \| `"assistant"` | System prompt is **not** a message. It lives on the thread. Tool messages are **folded into** the assistant node (`tool_calls`). |
| `content` | string | Markdown. For assistant nodes this is the final answer text |
| `status` | `"streaming"` \| `"complete"` \| `"stopped"` \| `"error"` | User messages are always `"complete"` |
| `model` | string \| null | Model that produced an assistant message; `null` for user |
| `attachments` | Attachment[] | Chat files sent with this message (user only; `[]` otherwise) |
| `tool_calls` | ToolCall[] | In call order (assistant only) |
| `sources` | Source[] | Retrieved chunks used for this answer, in citation order (`[1]` = index 0) |
| `reasoning` | string \| null | Reasoning trace (only when Think was on) |
| `error` | string \| null | Human-readable message when `status == "error"` |
| `feedback` | `"up"` \| `"down"` \| null | Thumbs rating |
| `created_at` | datetime | **Used to order siblings** (oldest first). Must be distinct enough to sort. |

### Attachment
A chat file as it appears on a user message (a snapshot of the `ChatFile`).

| Field | Type | Notes |
|---|---|---|
| `id` | string | `ChatFile.id` |
| `filename` | string | |
| `mime_type` | string | |
| `size_bytes` | int | |
| `processing` | `"inline"` \| `"rag"` | How it was fed to the model (§6) |

### ToolCall

| Field | Type | Notes |
|---|---|---|
| `id` | string | The LLM tool-call id is fine |
| `name` | string | Tool `name` |
| `arguments` | object | Parsed JSON arguments |
| `output` | string \| null | Tool result (JSON-encoded string is fine; the UI pretty-prints JSON). `null` while running |
| `status` | `"running"` \| `"success"` \| `"error"` | |

### Source

| Field | Type | Notes |
|---|---|---|
| `origin` | `"knowledge_base"` \| `"attachment"` | Where the chunk came from. The UI shows 📚 or 📎 |
| `file_id` | string | `KnowledgeDocument.id` or `ChatFile.id`, depending on `origin` |
| `filename` | string | |
| `chunk_id` | string | Unique per source in a message |
| `snippet` | string | Retrieved text (trim to ~500 chars) |
| `score` | float \| null | Similarity score |
| `page` | int \| null | Page number if known |

### ChatFile
A file uploaded into one thread (§6).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `thread_id` | string | |
| `message_id` | string \| null | First user message it was sent with. `null` while it's only staged in the composer |
| `filename` | string | |
| `mime_type` | string | |
| `size_bytes` | int | |
| `processing` | `"inline"` \| `"rag"` \| null | Decided by the backend after text extraction. `null` until decided |
| `status` | `"processing"` \| `"ready"` \| `"failed"` | |
| `token_count` | int \| null | Extracted text size, once known |
| `chunk_count` | int \| null | Number of indexed chunks (`rag` only) |
| `error` | string \| null | Why processing failed |
| `created_at` | datetime | |

### KnowledgeDocument
A document in the global knowledge base (§6).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `filename` | string | |
| `mime_type` | string | |
| `size_bytes` | int | |
| `status` | `"processing"` \| `"ready"` \| `"failed"` | |
| `chunk_count` | int \| null | Set when ready |
| `error` | string \| null | Why indexing failed |
| `created_at` | datetime | |

<details>
<summary>Full MessageNode JSON example</summary>

```json
{
  "id": "8d1c…",
  "thread_id": "f3a0…",
  "parent_id": "51be…",
  "role": "assistant",
  "content": "Refunds are accepted within **30 days** [1]. Your contract adds a 14-day extension [2].",
  "status": "complete",
  "model": "openai/gpt-oss-20b",
  "attachments": [],
  "tool_calls": [],
  "sources": [
    {
      "origin": "knowledge_base",
      "file_id": "kb-7…",
      "filename": "refund-policy.pdf",
      "chunk_id": "kb-7…:4",
      "snippet": "Customers may request a refund within 30 days…",
      "score": 0.83,
      "page": 2
    },
    {
      "origin": "attachment",
      "file_id": "cf-2…",
      "filename": "contract-2026.pdf",
      "chunk_id": "cf-2…:31",
      "snippet": "…the refund window is extended by 14 days…",
      "score": 0.79,
      "page": 12
    }
  ],
  "reasoning": "The user asks about refunds; cite the policy chunk…",
  "error": null,
  "feedback": null,
  "created_at": "2026-09-10T14:03:22.512Z"
}
```
</details>

---

## 4. How branching works

A thread's messages form a **tree** via `parent_id`. The UI shows one path from a root to a leaf.

```
thread.current_leaf_id ──────────────────────────┐
                                                 ▼
 U1 ── A1 ── U2  ── A2                    U2' ── A2'
              │                            ▲
              └──── (edit of U2 creates ───┘  a sibling with the same parent A1)
```

| User action | What the frontend sends | What the backend does |
|---|---|---|
| Send a message | `POST /threads/{id}/messages` with `parent_id` = last message on the visible path (`null` in an empty thread) | Save user node under `parent_id`, generate an assistant child |
| **Edit** message `U2` | Same endpoint, `parent_id = U2.parent_id` (i.e. `A1`), new `content`, **same `attachment_ids` as `U2`** | Identical to a normal send. The new `U2'` is simply a sibling of `U2`. **Never modify or delete `U2`.** |
| **Regenerate** answer `A2` | `POST /threads/{id}/messages/A2/regenerate` | New assistant node `A2''` with the same parent as `A2` |
| Switch branch `‹ 1/2 ›` | `PATCH /threads/{id}` `{ "current_leaf_id": "<leaf>" }` | Just store it |

**Rules for generation context:** when generating an answer for user node `U`, the LLM input is
`[system_prompt] + path(root → U)` along `parent_id` links only. Sibling branches must never leak into context.
The same applies to chat files (§6).

**`current_leaf_id`:** after every send/edit/regenerate, set it to the new assistant node's id.
On load, the UI shows the path ending at `current_leaf_id`. If it's `null` or unknown, the UI falls back to the newest branch.

*(How you persist this is up to you. LangGraph checkpoint forking or your own messages table both work,
as long as the API returns the tree described here.)*

---

## 5. Think & Knowledge base mode

Both switches live in the message box. Their state is sticky in the browser, and they are sent with **every** send, edit and regenerate request:

```json
{ "think": true, "knowledge_mode": "off" }
```

### `think: bool`
- Only meaningful when the model has `supports_reasoning: true`. The toggle is hidden for other models (they still receive `think`; ignore it).
- `true`: let the model reason. Stream the trace as `reasoning` events and store it in `MessageNode.reasoning`.
- `false`: answer directly with no/minimal reasoning. Send no `reasoning` events; `reasoning` stays `null`.
  How you implement "off" per provider (e.g. Groq `reasoning_effort: "low"`, `include_reasoning: false`, or a non-thinking model) is up to you.

### `knowledge_mode: "off" | "strict"`
The UI calls this **Knowledge base** mode.

| Value | Behaviour |
|---|---|
| `"off"` | Normal ChatGPT-like assistant. The global knowledge base is **not** searched. Chat files (§6) still work. |
| `"strict"` | Retrieve from the **global knowledge base** (plus this branch's indexed chat files) and answer **only** from the retrieved content. If nothing relevant is retrieved, say so clearly instead of answering from the model's own knowledge. Emit the chunks used as `sources` with the right `origin`. Tools that bring outside knowledge (e.g. `web_search`) should not be used in this mode. |

It's an enum so we can add more modes later (e.g. `"assist"`: knowledge base preferred, model knowledge allowed) without breaking the API.

---

## 6. Files: chat files vs. knowledge base

There are two separate file systems:

| | **Knowledge base** (global RAG) | **Chat files** (temporary, thread RAG) |
|---|---|---|
| Where the user adds them | Sidebar → Knowledge base | 📎 / paste / drag-drop in the message box |
| Scope | All chats | One thread, and only the branch they were sent on |
| Lifetime | Until deleted | Until removed or the thread is deleted |
| Used when | `knowledge_mode = "strict"` | Whenever a message on the current path has them attached |
| Endpoints | `/api/knowledge-base/documents` | `/api/threads/{thread_id}/files` |

### Chat file lifecycle

```
user picks file ──► POST /threads/{tid}/files ──► status "processing"
                                              │  (extract text, count tokens, decide)
                         small ◄──────────────┴──────────────► large
                   processing = "inline"                processing = "rag"
                   (keep the full text)                 (chunk → embed → store vectors in DB, keyed by thread)
                         └────────────► status "ready" ◄──────┘
UI polls GET /threads/{tid}/files/{id} every second, then enables Send
POST /threads/{tid}/messages { attachment_ids: [...] } ──► file.message_id = that user message
```

1. **Decide inline vs. RAG on the backend** after text extraction, by token count (e.g. ≤ ~8k tokens → `inline`). The UI shows "full text" or "indexed" accordingly.
2. **Index once.** Embeddings for `rag` files are persisted (tied to the thread) so later messages reuse them. The user waits only at upload time.
3. **Generation context** for user message `U`, using the files attached to **any user message on the path root → U**:
   - `inline` files: include their full text with the message they were attached to.
   - `rag` files: retrieve the top chunks for the **current question** from those files' vectors and include only the relevant ones (use a similarity threshold). If the user changes topic, nothing is retrieved, and the model answers normally.
   - Files attached on other branches must **not** be used.
4. Emit retrieved chunks as `sources` with `origin: "attachment"`. Inline files don't need sources.
5. Files uploaded but never sent (`message_id: null`) may be garbage-collected after ~24 h. The UI deletes them itself when the user removes a staged file.
6. `DELETE` on a sent file removes its text/vectors from future retrieval. Existing messages keep their `attachments` snapshot.

### Knowledge base lifecycle
`POST /knowledge-base/documents` → `processing` (load, chunk, embed into the persistent vector DB) → `ready`/`failed`. The UI polls while any document is processing.

---

## 7. Endpoints

Summary:

| Pri | Method | Path | Purpose |
|---|---|---|---|
| P0 | GET | `/api/health` | Liveness |
| P1 | GET | `/api/models` | Model picker, Think toggle visibility |
| P1 | GET | `/api/tools` | Tool toggles |
| P0 | GET | `/api/threads` | Sidebar list (paginated) |
| P0 | POST | `/api/threads` | Create thread |
| P0 | GET | `/api/threads/{thread_id}` | Thread details |
| P0 | PATCH | `/api/threads/{thread_id}` | Rename / settings / branch pointer |
| P0 | DELETE | `/api/threads/{thread_id}` | Delete thread (+ its chat files & vectors) |
| P0 | GET | `/api/threads/{thread_id}/messages` | Full message tree |
| P0 | POST | `/api/threads/{thread_id}/messages` | Send or edit → **SSE stream** |
| P1 | POST | `/api/threads/{thread_id}/messages/{message_id}/regenerate` | New answer → **SSE stream** |
| P1 | POST | `/api/threads/{thread_id}/messages/{message_id}/stop` | Stop generation |
| P2 | PUT | `/api/threads/{thread_id}/messages/{message_id}/feedback` | Thumbs up/down |
| P1 | POST | `/api/threads/{thread_id}/files` | Upload a chat file |
| P1 | GET | `/api/threads/{thread_id}/files` | List chat files |
| P1 | GET | `/api/threads/{thread_id}/files/{file_id}` | Poll processing status |
| P1 | DELETE | `/api/threads/{thread_id}/files/{file_id}` | Remove a chat file |
| P1 | GET | `/api/knowledge-base/documents` | List knowledge base |
| P1 | POST | `/api/knowledge-base/documents` | Upload to knowledge base |
| P1 | GET | `/api/knowledge-base/documents/{document_id}` | Poll indexing status |
| P1 | DELETE | `/api/knowledge-base/documents/{document_id}` | Delete from knowledge base |

---

### `GET /api/health` (P0)
**200** `{ "status": "ok" }`

---

### `GET /api/models` (P1)
**200** `Model[]`. The first item is treated as the default for new chats.

```json
[{ "id": "openai/gpt-oss-20b", "name": "GPT-OSS 20B", "description": "Fast thinking model", "supports_tools": true, "supports_reasoning": true }]
```

### `GET /api/tools` (P1)
**200** `Tool[]`

```json
[{ "name": "web_search", "display_name": "Web search", "description": "Search the web" }]
```

---

### `GET /api/threads` (P0)

| Query | Type | Default | Notes |
|---|---|---|---|
| `limit` | int | 30 | 1–100 |
| `cursor` | string | – | Opaque value from the previous `next_cursor` |
| `q` | string | – | Optional title search (P2; UI currently filters client-side) |

**200**, sorted by `updated_at` **descending**:
```json
{
  "items": [{ "id": "f3a0…", "title": "Refund policy", "created_at": "…", "updated_at": "…" }],
  "next_cursor": "30"
}
```
`next_cursor` is `null` on the last page.

### `POST /api/threads` (P0)
Called when the user sends the first message of a new chat, or attaches a file to one. All fields are optional.

```json
{
  "title": "New chat",
  "system_prompt": "You are a helpful assistant.",
  "model": "openai/gpt-oss-20b",
  "enabled_tools": ["web_search"]
}
```
Defaults: `title="New chat"`, `system_prompt=null`, `model=null`, `enabled_tools=[]`.
**201** (or 200) → `Thread` with `current_leaf_id: null`.
**422** for an unknown `model` or tool name.

### `GET /api/threads/{thread_id}` (P0)
**200** `Thread`. **404** if missing.

### `PATCH /api/threads/{thread_id}` (P0)
Partial update. Only the keys present are changed.

```json
{ "title": "Trip plan", "system_prompt": null, "model": "openai/gpt-oss-120b", "enabled_tools": [], "current_leaf_id": "8d1c…" }
```
- `system_prompt: null` clears it.
- `current_leaf_id` must belong to this thread (**422** otherwise).
- Changes apply to the **next** generation.

**200** → updated `Thread`. **404** if missing.

### `DELETE /api/threads/{thread_id}` (P0)
Deletes the thread, all its messages, its chat files and their vectors.
**204**. **404** if missing.

---

### `GET /api/threads/{thread_id}/messages` (P0)
The **entire tree**, all branches, so the UI can switch branches without more requests.

**200**
```json
{
  "thread_id": "f3a0…",
  "current_leaf_id": "8d1c…",
  "messages": [ /* MessageNode, any order (UI sorts by created_at) */ ]
}
```
**404** if the thread is missing.

### `POST /api/threads/{thread_id}/messages` (P0): send / edit, streams

Request:
```json
{
  "parent_id": "a1…",
  "content": "What does my contract say about refunds?",
  "attachment_ids": ["cf-2…"],
  "think": true,
  "knowledge_mode": "strict"
}
```

| Field | Rules |
|---|---|
| `parent_id` | `null` or an existing message **in this thread**. Normally an assistant node; for edits of the first message it's `null`. |
| `content` | Required, non-empty after trimming. |
| `attachment_ids` | `ChatFile` ids of **this thread**, each `status: "ready"` (**422** otherwise). Always sent (maybe `[]`). A file may be re-sent (e.g. on edit). |
| `think` | bool, §5 |
| `knowledge_mode` | `"off"` \| `"strict"`, §5 |

Validation errors (**404** thread, **422** body) must be returned as a **normal JSON error response before the stream starts**, not as SSE.

Success: **200** `Content-Type: text/event-stream`. The event sequence is in §8.

### `POST /api/threads/{thread_id}/messages/{message_id}/regenerate` (P1): streams
`message_id` is the **assistant** message being regenerated. Body:
```json
{ "think": false, "knowledge_mode": "off", "model": null }
```
`think` and `knowledge_mode` are the composer's current values (they may differ from the original answer). `model` optionally overrides the thread model for this one answer.
Creates a new assistant sibling (same `parent_id` as `message_id`). Streams like §8 **without** `user_message`.
**404** if the message is missing or not an assistant message.

### `POST /api/threads/{thread_id}/messages/{message_id}/stop` (P1)
`message_id` = the streaming assistant message. Cancel generation, persist the partial `content` with `status: "stopped"`.
**204**. Idempotent: return 204 even if it already finished.

Also note: when the user presses Stop, the frontend **aborts the HTTP request** as well.
The backend must treat a client disconnect the same way (catch the disconnect or `asyncio.CancelledError`, save partial output as `stopped`).

### `PUT /api/threads/{thread_id}/messages/{message_id}/feedback` (P2)
```json
{ "rating": "up" }
```
`rating`: `"up"`, `"down"`, or `null` (clear). **200** → updated `MessageNode`.

---

### `POST /api/threads/{thread_id}/files` (P1)
`multipart/form-data` with part `file`. The UI uploads as soon as the user attaches, before they press Send.

**201** (or 200) → `ChatFile`, normally `status: "processing"`, `processing: null`, `message_id: null`.
Do extraction/indexing in the background.
Errors: **404** unknown thread, **413** too large, **415** unsupported type. Put the limits in `detail`, e.g. `"Only PDF, TXT, MD, DOCX up to 50 MB"`.

### `GET /api/threads/{thread_id}/files` (P1)
**200** `ChatFile[]`, oldest first. Shown under **Chat settings → Files in this chat**.

### `GET /api/threads/{thread_id}/files/{file_id}` (P1)
**200** `ChatFile`. Polled every second while processing. Set `processing` as soon as you know it, so the UI can show "Reading…" vs. "Indexing for search…".
**404** if missing or not in this thread.

### `DELETE /api/threads/{thread_id}/files/{file_id}` (P1)
Remove the file, its text and its vectors. **204**. **404** if missing.

---

### `GET /api/knowledge-base/documents` (P1)
**200** `KnowledgeDocument[]`, oldest first.

### `POST /api/knowledge-base/documents` (P1)
`multipart/form-data` with part `file`. **201** (or 200) → `KnowledgeDocument` with `status: "processing"`.
Errors: **413** / **415** as above.

### `GET /api/knowledge-base/documents/{document_id}` (P1)
**200** `KnowledgeDocument`. **404** if missing.

### `DELETE /api/knowledge-base/documents/{document_id}` (P1)
Remove the document and its vectors. **204**. **404** if missing.

---

## 8. Streaming protocol (SSE)

Streaming endpoints respond with `text/event-stream`. Each event is:

```
event: <name>
data: <single-line JSON>

```
(one blank line terminates the event). Lines starting with `:` are comments. Send `: ping` every ~15 s during long tool calls or retrieval, so proxies don't close the connection.
Recommended headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

### Events

| Event | `data` | When |
|---|---|---|
| `user_message` | `{ "message": MessageNode }` | **First**, send/edit only. The saved user node (real id, with `attachments`). |
| `assistant_start` | `{ "message": MessageNode }` | Assistant node created, `status: "streaming"`, empty `content`. |
| `reasoning` | `{ "message_id": str, "delta": str }` | Only when `think: true`. Reasoning text chunks. |
| `tool_call` | `{ "message_id": str, "tool_call": ToolCall }` | Tool invoked (`status: "running"`, `output: null`). Re-sending the same `tool_call.id` replaces it. |
| `tool_result` | `{ "message_id": str, "tool_call_id": str, "output": str, "status": "success" \| "error" }` | Tool finished. |
| `sources` | `{ "message_id": str, "sources": Source[] }` | Retrieved chunks used (knowledge base and/or chat files). Replaces any earlier list. Send it before the tokens that cite them. |
| `token` | `{ "message_id": str, "delta": str }` | Answer text chunk, appended to `content`. |
| `title` | `{ "thread_id": str, "title": str }` | Optional. Auto-generated title (e.g. after the first exchange). Any time before `done`. |
| `done` | `{ "message": MessageNode }` | **Last event on success.** The final persisted assistant node (`status: "complete"`). It **replaces** the streamed copy, so it must include full `content`, `reasoning`, `tool_calls`, `sources`. |
| `error` | `{ "message_id": str \| null, "detail": str }` | **Last event on failure** after the stream began. With a `message_id`, the UI shows the error on that message with Retry (persist it as `status: "error"`). With `null`, it shows a toast. |

### Ordering guarantees the UI relies on

1. `user_message` (send/edit only) → `assistant_start` → any mix of `reasoning` / `tool_call` / `tool_result` / `sources` / `token` / `title` → exactly one `done` **or** `error` → close the stream.
2. Every event with `message_id` refers to the assistant node from `assistant_start`.
3. IDs in the stream are the real persisted IDs (the UI replaces its optimistic temp node with `user_message.message`).
4. If the stream closes without `done`/`error`, the UI marks the answer as failed.

### Example: Knowledge base mode with an indexed chat file

```
event: user_message
data: {"message":{"id":"u-2","thread_id":"t-1","parent_id":"a-1","role":"user","content":"What does my contract say about refunds?","status":"complete","model":null,"attachments":[{"id":"cf-2","filename":"contract-2026.pdf","mime_type":"application/pdf","size_bytes":4821933,"processing":"rag"}],"tool_calls":[],"sources":[],"reasoning":null,"error":null,"feedback":null,"created_at":"2026-09-10T14:03:20.100Z"}}

event: assistant_start
data: {"message":{"id":"a-2","thread_id":"t-1","parent_id":"u-2","role":"assistant","content":"","status":"streaming","model":"openai/gpt-oss-20b","attachments":[],"tool_calls":[],"sources":[],"reasoning":null,"error":null,"feedback":null,"created_at":"2026-09-10T14:03:20.300Z"}}

event: reasoning
data: {"message_id":"a-2","delta":"Look for refund clauses in the policy and the contract."}

: ping

event: sources
data: {"message_id":"a-2","sources":[{"origin":"knowledge_base","file_id":"kb-7","filename":"refund-policy.pdf","chunk_id":"kb-7:4","snippet":"Customers may request a refund within 30 days…","score":0.83,"page":2},{"origin":"attachment","file_id":"cf-2","filename":"contract-2026.pdf","chunk_id":"cf-2:31","snippet":"…extended by 14 days…","score":0.79,"page":12}]}

event: token
data: {"message_id":"a-2","delta":"Refunds are accepted within 30 days [1]. "}

event: token
data: {"message_id":"a-2","delta":"Your contract extends this by 14 days [2]."}

event: done
data: {"message":{"id":"a-2","thread_id":"t-1","parent_id":"u-2","role":"assistant","content":"Refunds are accepted within 30 days [1]. Your contract extends this by 14 days [2].","status":"complete","model":"openai/gpt-oss-20b","attachments":[],"tool_calls":[],"sources":[{"origin":"knowledge_base","file_id":"kb-7","filename":"refund-policy.pdf","chunk_id":"kb-7:4","snippet":"Customers may request a refund within 30 days…","score":0.83,"page":2},{"origin":"attachment","file_id":"cf-2","filename":"contract-2026.pdf","chunk_id":"cf-2:31","snippet":"…extended by 14 days…","score":0.79,"page":12}],"reasoning":"Look for refund clauses in the policy and the contract.","error":null,"feedback":null,"created_at":"2026-09-10T14:03:20.300Z"}}

```

FastAPI hint: `StreamingResponse(gen(), media_type="text/event-stream")` where each yield is
`f"event: {name}\ndata: {json.dumps(payload)}\n\n"`. LangGraph's `stream_mode="messages"` maps naturally onto `token` events.

---

## 9. Errors

Use FastAPI's standard error shape. The UI shows `detail` to the user, so keep it human-readable.

```json
{ "detail": "Thread not found" }
```

Pydantic 422s (`detail` as a list) are also handled: the UI renders them as `field: msg`.

| Status | Used for |
|---|---|
| 400 | Semantically invalid request |
| 404 | Unknown thread / message / file / document |
| 409 | Thread is already generating (optional: if you disallow concurrent generation per thread) |
| 413 / 415 | Upload too large / unsupported type |
| 422 | Validation errors (incl. attachment not ready) |
| 500 | Unexpected (don't leak stack traces in `detail`) |

---

## 10. CORS & local dev

- **Dev:** run FastAPI on `http://localhost:8000` and the frontend with `npm run dev` (port 5173).
  Vite proxies `/api/*` → `:8000`, so **no CORS config is needed in dev**. The target can be changed with `BACKEND_URL` in `frontend/.env`.
- **Prod / no proxy:** allow origin `http://localhost:5173` (and the deployed frontend origin) with
  `CORSMiddleware(allow_origins=[...], allow_methods=["*"], allow_headers=["*"])`.
- No authentication yet. If you add it, tell me the scheme (e.g. `Authorization: Bearer`) and I'll add it to the client.

---

## 11. Implementation checklist

Suggested order. Flip the frontend to live mode (`VITE_USE_MOCK=false`) after P0.

- [ ] P0 `GET /api/health`
- [ ] P0 Threads CRUD (`GET/POST /threads`, `GET/PATCH/DELETE /threads/{id}`)
- [ ] P0 `GET /threads/{id}/messages` returns the tree
- [ ] P0 `POST /threads/{id}/messages` SSE: `user_message`, `assistant_start`, `token`, `done`, `error`
- [ ] P0 System prompt + `parent_id` path used as LLM context; `current_leaf_id` updated
- [ ] P1 `GET /models` (with `supports_reasoning`), `GET /tools`
- [ ] P1 `think` on/off + `reasoning` events
- [ ] P1 Regenerate + stop (incl. client disconnect → `stopped`)
- [ ] P1 Tool calling events (`tool_call`, `tool_result`)
- [ ] P1 Chat files: upload → extract → inline/RAG decision → index once → `ready`; path-scoped context; `sources` with `origin: "attachment"`
- [ ] P1 Knowledge base CRUD + `knowledge_mode: "strict"` grounded answers; `sources` with `origin: "knowledge_base"`
- [ ] P1 `title` event
- [ ] P2 Feedback, `q` search, GC of unsent chat files

---

## 12. Open questions for the AI engineer

1. **Inline threshold:** what token limit separates `inline` from `rag` chat files? (I suggested ~8k; the UI doesn't care, it just displays the result.)
2. **Upload limits:** which file types and max size for chat files and the knowledge base? I'll show them in the UI.
3. **Strict mode + chat files:** I specified that Knowledge base mode searches the knowledge base **and** the branch's chat files. Should it be knowledge base only?
4. **Concurrency:** may a thread generate two answers at once? The UI allows one active stream at a time.
