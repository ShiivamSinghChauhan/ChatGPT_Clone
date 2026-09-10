import { useSyncExternalStore } from "react";

// Two routes only ("/" and "/c/:threadId"), so a tiny history router is enough.
// The current path is also kept in memory, so routing still works where the History API
// is blocked (e.g. sandboxed iframes / hosted previews).

const listeners = new Set<() => void>();
let currentPath = window.location.pathname;

window.addEventListener("popstate", () => {
  currentPath = window.location.pathname;
  listeners.forEach((l) => l());
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function navigate(path: string, { replace = false }: { replace?: boolean } = {}) {
  if (currentPath === path) return;
  currentPath = path;
  try {
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
  } catch {
    /* History API unavailable: keep routing in memory */
  }
  listeners.forEach((l) => l());
}

function parseThreadId(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getRouteThreadId(): string | null {
  return parseThreadId(currentPath);
}

const getPath = () => currentPath;

export function useRouteThreadId(): string | null {
  return parseThreadId(useSyncExternalStore(subscribe, getPath, getPath));
}
