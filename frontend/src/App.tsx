import { useEffect, useState } from "react";
import { ChatHeader } from "./components/ChatHeader";
import { ChatView } from "./components/ChatView";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { useRouteThreadId } from "./lib/router";
import { useMediaQuery } from "./lib/useMediaQuery";
import { useChat } from "./store/chat";

const MOBILE = "(max-width: 767px)";

export default function App() {
  const init = useChat((s) => s.init);
  const threadId = useRouteThreadId();
  const isMobile = useMediaQuery(MOBILE);
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia(MOBILE).matches);

  const title = useChat((s) => (threadId ? s.threads.find((t) => t.id === threadId)?.title : undefined));

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    document.title = title ? `${title} · Chat` : "Chat";
  }, [title]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        isMobile={isMobile}
        activeThreadId={threadId}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader
          threadId={threadId}
          showSidebarButton={!sidebarOpen || isMobile}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
        <ChatView threadId={threadId} />
      </main>
      <Toasts />
    </div>
  );
}
