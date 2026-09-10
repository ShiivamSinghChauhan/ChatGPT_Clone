import { memo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import type { MessageNode } from "../api";
import { cn, formatBytes } from "../lib/format";
import { isTempId, useChat } from "../store/chat";
import { Reasoning, Sources, ToolCallCard } from "./AssistantParts";
import { Markdown } from "./Markdown";
import { AttachmentChip, AutoTextarea, Button, CopyButton, IconButton, ThinkingIndicator } from "./ui";

interface Props {
  threadId: string;
  node: MessageNode;
  siblings: MessageNode[];
  isLast: boolean;
  /** A response is streaming somewhere; editing/regenerating/switching is disabled. */
  busy: boolean;
  isStreaming: boolean;
}

export const MessageItem = memo(function MessageItem(props: Props) {
  return props.node.role === "user" ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});

function BranchSwitcher({ threadId, node, siblings, disabled }: Pick<Props, "threadId" | "node" | "siblings"> & { disabled: boolean }) {
  const switchBranch = useChat((s) => s.switchBranch);
  if (siblings.length < 2) return null;
  const i = siblings.findIndex((s) => s.id === node.id);

  return (
    <div className="flex items-center text-xs tabular-nums text-ink-muted">
      <IconButton
        label="Previous version"
        className="h-7 w-7"
        disabled={disabled || i <= 0}
        onClick={() => switchBranch(threadId, siblings[i - 1].id)}
      >
        <ChevronLeft size={16} />
      </IconButton>
      <span>
        {i + 1}/{siblings.length}
      </span>
      <IconButton
        label="Next version"
        className="h-7 w-7"
        disabled={disabled || i >= siblings.length - 1}
        onClick={() => switchBranch(threadId, siblings[i + 1].id)}
      >
        <ChevronRight size={16} />
      </IconButton>
    </div>
  );
}

const hoverReveal = "md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity";

function UserMessage({ threadId, node, siblings, busy }: Props) {
  const edit = useChat((s) => s.edit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.content);
  const temp = isTempId(node.id);

  const cancel = () => {
    setEditing(false);
    setDraft(node.content);
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setEditing(false);
    if (text !== node.content.trim()) void edit(threadId, node.id, text);
  };

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full rounded-3xl bg-subtle p-3 sm:max-w-[85%]">
          <AutoTextarea
            autoFocus
            value={draft}
            onChange={setDraft}
            maxHeight={320}
            aria-label="Edit message"
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={cancel}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !draft.trim()}>
              Send
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      {node.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {node.attachments.map((a) => (
            <AttachmentChip
              key={a.id}
              name={a.filename}
              meta={`${formatBytes(a.size_bytes)} · ${a.processing === "rag" ? "indexed" : "full text"}`}
            />
          ))}
        </div>
      )}
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-subtle px-5 py-2.5 sm:max-w-[70%]">
        {node.content}
      </div>
      <div className={cn("flex items-center gap-0.5", temp && "invisible")}>
        <div className={cn("flex items-center gap-0.5", hoverReveal)}>
          <CopyButton getText={() => node.content} />
          <IconButton
            label="Edit message"
            disabled={busy}
            onClick={() => {
              setDraft(node.content);
              setEditing(true);
            }}
          >
            <Pencil size={16} />
          </IconButton>
        </div>
        <BranchSwitcher threadId={threadId} node={node} siblings={siblings} disabled={busy} />
      </div>
    </div>
  );
}

function AssistantMessage({ threadId, node, siblings, isLast, busy, isStreaming }: Props) {
  const regenerate = useChat((s) => s.regenerate);
  const setFeedback = useChat((s) => s.setFeedback);
  const tools = useChat((s) => s.tools);
  const modelName = useChat((s) => s.models.find((m) => m.id === node.model)?.name ?? node.model);

  const nothingYet = !node.content && !node.reasoning && node.tool_calls.length === 0;

  return (
    <div className="group flex flex-col gap-2">
      {node.reasoning && <Reasoning text={node.reasoning} active={isStreaming && !node.content} />}

      {node.tool_calls.map((call) => (
        <ToolCallCard key={call.id} call={call} displayName={tools.find((t) => t.name === call.name)?.display_name} />
      ))}

      {node.content ? (
        <Markdown content={node.content} streaming={isStreaming} />
      ) : (
        isStreaming && nothingYet && <ThinkingIndicator />
      )}

      {node.status === "error" && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{node.error ?? "Something went wrong while generating this response."}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void regenerate(threadId, node.id)}
            className="font-medium hover:underline disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {node.status === "stopped" && <p className="text-xs text-ink-muted">Response stopped</p>}

      {node.sources.length > 0 && <Sources sources={node.sources} />}

      {!isStreaming && (
        <div className="-ml-1.5 flex items-center gap-0.5">
          <BranchSwitcher threadId={threadId} node={node} siblings={siblings} disabled={busy} />
          <div className={cn("flex items-center gap-0.5", !isLast && hoverReveal)}>
            <CopyButton getText={() => node.content} />
            <IconButton
              label="Good response"
              aria-pressed={node.feedback === "up"}
              className={cn(node.feedback === "up" && "text-ink")}
              onClick={() => void setFeedback(threadId, node.id, node.feedback === "up" ? null : "up")}
            >
              <ThumbsUp size={16} fill={node.feedback === "up" ? "currentColor" : "none"} />
            </IconButton>
            <IconButton
              label="Bad response"
              aria-pressed={node.feedback === "down"}
              className={cn(node.feedback === "down" && "text-ink")}
              onClick={() => void setFeedback(threadId, node.id, node.feedback === "down" ? null : "down")}
            >
              <ThumbsDown size={16} fill={node.feedback === "down" ? "currentColor" : "none"} />
            </IconButton>
            <IconButton label="Regenerate" disabled={busy} onClick={() => void regenerate(threadId, node.id)}>
              <RefreshCw size={16} />
            </IconButton>
            {modelName && <span className="ml-1 hidden text-xs text-ink-muted sm:inline">{modelName}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
