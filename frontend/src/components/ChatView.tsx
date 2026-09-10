import { useEffect, useMemo } from "react";
import { CircleAlert } from "lucide-react";
import type { MessageNode } from "../api";
import { cn } from "../lib/format";
import { navigate } from "../lib/router";
import { activePath, buildChildIndex } from "../lib/tree";
import { useChat } from "../store/chat";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { Button, Spinner } from "./ui";

const EMPTY: Record<string, MessageNode> = {};

export function ChatView({ threadId }: { threadId: string | null }) {
  const openThread = useChat((s) => s.openThread);
  const data = useChat((s) => (threadId ? s.data[threadId] : undefined));
  const streamingHere = useChat((s) => threadId !== null && s.streaming?.threadId === threadId);

  useEffect(() => {
    if (threadId) void openThread(threadId);
  }, [threadId, openThread]);

  const nodes = data?.nodes ?? EMPTY;
  const index = useMemo(() => buildChildIndex(nodes), [nodes]);
  const path = useMemo(() => activePath(nodes, index, data?.leafId ?? null), [nodes, index, data?.leafId]);

  const loading = threadId !== null && (!data || data.status === "loading");
  const failed = threadId !== null && data?.status === "error";
  const empty = !loading && !failed && path.length === 0 && !streamingHere;

  let body;
  if (loading) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  } else if (failed) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <CircleAlert size={28} className="text-ink-muted" />
        <p className="text-ink-muted">{data?.error}</p>
        <div className="flex gap-2">
          <Button onClick={() => void openThread(threadId!)}>Retry</Button>
          <Button variant="primary" onClick={() => navigate("/")}>
            New chat
          </Button>
        </div>
      </div>
    );
  } else if (empty) {
    body = (
      <div className="flex flex-1 items-center justify-center px-4 pb-4 md:flex-none md:pb-8">
        <h1 className="text-center text-2xl font-semibold md:text-3xl">What can I help with?</h1>
      </div>
    );
  } else {
    body = <MessageList threadId={threadId!} index={index} path={path} />;
  }

  // The composer stays mounted in the same tree position across states so its text survives
  // the switch from the empty screen to the message list.
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", empty && "md:justify-center md:pb-[12vh]")}>
      {body}
      {!failed && <Composer threadId={threadId} disabled={loading} />}
    </div>
  );
}
