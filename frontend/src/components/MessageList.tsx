import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { MessageNode } from "../api";
import { siblingsOf, type ChildIndex } from "../lib/tree";
import { useChat } from "../store/chat";
import { MessageItem } from "./MessageItem";
import { ThinkingIndicator } from "./ui";

interface Props {
  threadId: string;
  index: ChildIndex;
  path: MessageNode[];
}

export function MessageList({ threadId, index, path }: Props) {
  const streaming = useChat((s) => s.streaming);
  const busy = streaming !== null;
  const streamingHere = streaming?.threadId === threadId ? streaming : null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Stay pinned to the bottom while content grows (streaming tokens, images, code blocks).
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  // Opening a thread starts at the bottom.
  useLayoutEffect(() => {
    pinned.current = true;
    setAtBottom(true);
    scrollToBottom();
  }, [threadId, scrollToBottom]);

  // Sending a message (or edit) jumps to the bottom even if the user had scrolled up.
  const lastUserId = streamingHere ? path.findLast((n) => n.role === "user")?.id : undefined;
  useLayoutEffect(() => {
    if (!lastUserId) return;
    pinned.current = true;
    setAtBottom(true);
    scrollToBottom();
  }, [lastUserId, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinned.current = bottom;
    setAtBottom(bottom);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto [overflow-anchor:none]">
        <div ref={contentRef} className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-8 pt-2">
          {path.map((node, i) => (
            <MessageItem
              key={node.id}
              threadId={threadId}
              node={node}
              siblings={siblingsOf(index, node)}
              isLast={i === path.length - 1}
              busy={busy}
              isStreaming={streamingHere?.assistantId === node.id}
            />
          ))}
          {streamingHere && streamingHere.assistantId === null && <ThinkingIndicator />}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          aria-label="Scroll to bottom"
          onClick={() => {
            pinned.current = true;
            scrollToBottom("smooth");
          }}
          className="absolute bottom-3 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-elevated shadow-md hover:bg-hover"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
