import { liveApi } from "./client";
import { mockApi } from "./mock";
import type { ChatApi } from "./types";

// Mock is the default so the UI runs without a backend. Set VITE_USE_MOCK=false to hit FastAPI.
const useMock = (import.meta.env.VITE_USE_MOCK ?? "true").toLowerCase() !== "false";

export const api: ChatApi = useMock ? mockApi : liveApi;
export { ApiError, isAbortError } from "./client";
export type * from "./types";
