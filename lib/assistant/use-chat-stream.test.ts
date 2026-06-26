import { describe, it, expect } from "bun:test";
import { parseChatFrame } from "./use-chat-stream";

/**
 * parseChatFrame is the single SSE-frame parser shared by ConversationalChat
 * (welcome) and BriefcaseChat (global pill) — the DRY point so there is ONE
 * multi-turn streaming implementation, not three (A-6).
 */

describe("parseChatFrame", () => {
  it("parses a text delta frame", () => {
    expect(parseChatFrame('data: {"text":"hello"}')).toEqual({ text: "hello" });
  });
  it("parses a done frame", () => {
    expect(parseChatFrame('data: {"done":true}')).toEqual({ done: true });
  });
  it("parses an error frame", () => {
    expect(parseChatFrame('data: {"error":"boom"}')).toEqual({ error: "boom" });
  });
  it("tolerates surrounding whitespace and the data: prefix", () => {
    expect(parseChatFrame('  data: {"text":"x"}  ')).toEqual({ text: "x" });
  });
  it("returns null for a blank frame", () => {
    expect(parseChatFrame("")).toBeNull();
    expect(parseChatFrame("   ")).toBeNull();
  });
  it("returns null for non-JSON (never throws)", () => {
    expect(parseChatFrame("data: not json")).toBeNull();
    expect(parseChatFrame("data: {oops")).toBeNull();
  });
});
