"use client";

import { useEffect, useRef, useState } from "react";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export interface ChatFrame {
  text?: string;
  done?: boolean;
  error?: string;
  /** Typed prelude frames (e.g. the welcome route's `place` / `data` cards). The
   *  hook itself only renders `text` and surfaces `error`; a consumer that paints
   *  cards subscribes via `onFrame` (see useWelcomeStream for the hero surface). */
  type?: string;
  [key: string]: unknown;
}

/**
 * Parse ONE SSE frame block (`data: {...}`) into a chat delta. Pure + defensive:
 * returns null for blanks / non-JSON instead of throwing. This is the single
 * shared parser so ConversationalChat (welcome) and BriefcaseChat (global pill)
 * run ONE multi-turn streaming implementation, not separate copies (A-6 DRY).
 */
export function parseChatFrame(frame: string): ChatFrame | null {
  const line = frame.replace(/^\s*data:\s*/, "").trim();
  if (!line) return null;
  try {
    return JSON.parse(line) as ChatFrame;
  } catch {
    return null;
  }
}

/**
 * Multi-turn SSE chat against a token-streaming endpoint (default
 * /api/welcome/chat). Owns the messages + busy state and the fetch-reader loop;
 * all dispatches happen inside the submit-triggered async callback — never an
 * effect body — so it's clear of react-hooks/set-state-in-effect.
 */
export interface UseChatStreamOptions {
  /** Called for EVERY parsed frame, including typed prelude frames (place/data).
   *  Lets a consumer paint cards without the hook needing to know about them. */
  onFrame?: (frame: ChatFrame) => void;
}

export function useChatStream(
  endpoint: string = "/api/welcome/chat",
  opts: UseChatStreamOptions = {},
) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  // Abort the in-flight stream if the component unmounts mid-read (so the reader
  // loop + setState don't outlive the pill/panel being closed).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  function failLastMessage() {
    setMessages((m) => {
      const copy = [...m];
      copy[copy.length - 1] = {
        role: "assistant",
        content: "Sorry — something went wrong. Try again.",
      };
      return copy;
    });
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
        signal: controller.signal,
      });
      // fetch only rejects on a network error — a 4xx/5xx still resolves. Without
      // this guard a JSON error body streams into an empty assistant bubble (or
      // nothing renders); turn it into the friendly catch path instead.
      if (!res.ok) throw new Error(`chat endpoint ${res.status}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const evt = parseChatFrame(frame);
          if (!evt) continue;
          // Hand every frame to the consumer (typed place/data cards, etc.).
          opts.onFrame?.(evt);
          // A server-side stream error arrives as a typed `error` frame, NOT an
          // HTTP error — surface it instead of silently dropping it (was: empty bubble).
          if (evt.error) throw new Error(evt.error);
          if (evt.text) {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                role: "assistant",
                content: copy[copy.length - 1].content + evt.text,
              };
              return copy;
            });
          }
        }
      }
    } catch (e) {
      // Unmounted mid-stream → the abort is expected; don't touch state.
      if (e instanceof DOMException && e.name === "AbortError") return;
      failLastMessage();
    } finally {
      setBusy(false);
    }
  }

  return { messages, busy, send };
}
