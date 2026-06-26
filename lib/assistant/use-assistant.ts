"use client";

// Unified entry point for all assistant React hooks. Import from here instead
// of the individual files so the assistant surface has one import root.
export type { UseConverse } from "./use-converse";
export { useConverse } from "./use-converse";
export type { ConverseInput, ConverseHandlers } from "./converse";
export { streamConverse, splitFollowupTail } from "./converse";
export type { UseChatStreamOptions, ChatMsg, ChatFrame } from "./use-chat-stream";
export { useChatStream, parseChatFrame } from "./use-chat-stream";
