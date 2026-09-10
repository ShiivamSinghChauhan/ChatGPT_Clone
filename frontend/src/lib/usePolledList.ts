import { useCallback, useEffect, useState } from "react";
import type { FileStatus } from "../api";
import { errorMessage } from "./format";

/**
 * Loads a list of files/documents and re-fetches every 1.5 s while any item is still processing.
 * `load` must be stable (wrap it in useCallback).
 */
export function usePolledList<T extends { status: FileStatus }>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await load());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const processing = items?.some((i) => i.status === "processing") ?? false;
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [processing, refresh]);

  return { items, setItems, error, refresh };
}
