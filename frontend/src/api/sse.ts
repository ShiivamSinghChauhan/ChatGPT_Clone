import type { StreamEvent } from "./types";

const KNOWN_EVENTS = new Set<StreamEvent["event"]>([
  "user_message",
  "assistant_start",
  "token",
  "reasoning",
  "tool_call",
  "tool_result",
  "sources",
  "title",
  "done",
  "error",
]);

/**
 * Parses a `text/event-stream` body (per the WHATWG SSE spec) into typed events.
 * We can't use EventSource because it only supports GET without a body.
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];
  let finished = false;

  const takeEvent = (): StreamEvent | null => {
    const name = eventName || "message";
    const raw = dataLines.join("\n");
    eventName = "";
    dataLines = [];
    if (!KNOWN_EVENTS.has(name as StreamEvent["event"])) return null; // forward-compatible: ignore unknown events
    try {
      return { event: name, data: JSON.parse(raw) } as StreamEvent;
    } catch {
      console.warn(`[sse] could not parse data for event "${name}":`, raw);
      return null;
    }
  };

  // Returns an event when a blank line terminates one.
  const processLine = (line: string): StreamEvent | null => {
    if (line === "") return dataLines.length ? takeEvent() : ((eventName = ""), null);
    if (line.startsWith(":")) return null; // comment / keepalive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let match: number;
      while ((match = buffer.search(/\r\n|\r|\n/)) >= 0) {
        // A trailing "\r" might be the first half of "\r\n" split across chunks.
        if (!done && buffer[match] === "\r" && match === buffer.length - 1) break;
        const line = buffer.slice(0, match);
        buffer = buffer.slice(match + (buffer.startsWith("\r\n", match) ? 2 : 1));
        const ev = processLine(line);
        if (ev) yield ev;
      }

      if (done) {
        if (buffer) {
          const ev = processLine(buffer);
          if (ev) yield ev;
        }
        if (dataLines.length) {
          const ev = takeEvent();
          if (ev) yield ev;
        }
        finished = true;
        return;
      }
    }
  } finally {
    if (!finished) reader.cancel().catch(() => {});
  }
}
