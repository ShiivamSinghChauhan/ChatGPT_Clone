# Chat Frontend

ChatGPT-style UI for the LangGraph chatbot. It supports multi-thread chats, editing any message to branch the conversation,
regenerating answers, per-chat system prompts, tool-call display, RAG document uploads with source chips, streaming, and stopping.

**Backend engineers: start at [`API_CONTRACT.md`](./API_CONTRACT.md).** It lists every endpoint, payload, and streaming event the UI uses.

## Quick start

```bash
cd frontend
npm install
cp .env.example .env   # optional; defaults to mock mode
npm run dev            # http://localhost:5173
```

### Mock vs. live backend

| `VITE_USE_MOCK` | Behaviour |
|---|---|
| `true` (default) | In-browser fake backend (`src/api/mock.ts`), persisted in localStorage. No Python needed. |
| `false` | Real FastAPI. In dev, requests to `/api` are proxied to `BACKEND_URL` (default `http://localhost:8000`). |

Restart `npm run dev` after changing `.env`.

Mock-mode tricks:
- Toggle **Think** in the message box to turn the reasoning trace on or off. The toggle is hidden for Llama, a non-thinking model.
- Open **Knowledge base** in the sidebar, upload a file, then turn on **Knowledge base** mode. Answers now come only from those documents; with an empty knowledge base, the assistant refuses.
- Attach a file **under 100 KB** to have it read in full (inline). A file **over 100 KB** is indexed once and then retrieved on later messages (RAG), shown as 📎 source chips.
- Enable tools in **Settings**, then ask "weather in Paris" or "calculate 12*7". Send `/error` to see the error state.
- Clear mock data with `localStorage.removeItem("mock-backend-v2")` in the browser console.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR and `/api` proxy |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run preview` | Serve the production build |

Deploying `dist/`: configure the host to serve `index.html` for unknown paths (SPA fallback, needed for `/c/:threadId`), and set
`VITE_API_BASE_URL` at build time if the API is on another origin.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · zustand · react-markdown (GFM + highlight.js) · lucide-react

## Project layout

```
src/
  api/
    types.ts        TypeScript mirror of API_CONTRACT.md
    client.ts       fetch wrapper for FastAPI (errors, JSON, SSE streams)
    sse.ts          text/event-stream parser (POST-capable, unlike EventSource)
    mock.ts         in-browser implementation of the contract
    index.ts        picks live or mock via VITE_USE_MOCK
  store/chat.ts     app state: threads, message trees, streaming, branching actions
  lib/tree.ts       message-tree helpers (active path, siblings, newest leaf)
  lib/router.ts     tiny router for "/" and "/c/:threadId"
  components/
    Sidebar.tsx              thread list, search, rename/delete, theme
    ChatHeader.tsx           model picker, settings button
    ThreadSettingsDialog.tsx system prompt, tools, documents
    ChatView.tsx             loading / empty / conversation states
    MessageList.tsx          scrolling + auto-follow while streaming
    MessageItem.tsx          user/assistant messages, edit, branch switcher, actions
    AssistantParts.tsx       reasoning, tool-call cards, sources
    Markdown.tsx             markdown + code blocks with copy
    Composer.tsx             input, attachments (upload/poll), send/stop
```

## How branching works in the UI

Messages are stored per thread as a tree (`parent_id`). The thread's `leafId` selects which path is visible.
- **Edit** sends a new user message with the edited message's parent, creating a sibling.
- **Regenerate** creates an assistant sibling.
- The `‹ 2/3 ›` switcher jumps to a sibling's newest leaf and persists the choice via `PATCH /threads/{id}` `{current_leaf_id}`.
