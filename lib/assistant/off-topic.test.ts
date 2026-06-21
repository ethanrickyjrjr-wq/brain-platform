import { test, expect } from "bun:test";
import { isOffTopicQuestion } from "./off-topic";

test("off-domain question that merely names a SWFL place → off-topic (no cards)", () => {
  expect(isOffTopicQuestion("best Arby's near Cleveland Ave in Fort Myers")).toBe(true);
  expect(isOffTopicQuestion("what restaurants are near 33908?")).toBe(true);
  expect(isOffTopicQuestion("what's the weather in Naples today?")).toBe(true);
  expect(isOffTopicQuestion("directions to the airport in Fort Myers")).toBe(true);
  expect(isOffTopicQuestion("what time does the mall in Estero close?")).toBe(true);
});

test("real market-data questions are NEVER gated as off-topic", () => {
  expect(isOffTopicQuestion("Is Fort Myers Beach a good buy right now?")).toBe(false);
  expect(isOffTopicQuestion("How's the Lee County housing market?")).toBe(false);
  expect(isOffTopicQuestion("What's the flood risk in 33931?")).toBe(false);
  expect(isOffTopicQuestion("median home value in Cape Coral")).toBe(false);
  expect(isOffTopicQuestion("asking rent on the Naples corridors")).toBe(false);
  expect(isOffTopicQuestion("permit velocity in Lehigh Acres")).toBe(false);
});

test("a question carrying BOTH signals stays in-scope (data wins — don't suppress)", () => {
  // a food/anchor question that is really about its market effect
  expect(isOffTopicQuestion("how does the new restaurant affect property values in Naples?")).toBe(
    false,
  );
  expect(isOffTopicQuestion("should I buy a gym franchise in Cape Coral?")).toBe(false);
});

test("neutral / capability questions are not off-topic (need an off-domain signal)", () => {
  expect(isOffTopicQuestion("what can you do?")).toBe(false);
  expect(isOffTopicQuestion("tell me about Cape Coral")).toBe(false);
  expect(isOffTopicQuestion("")).toBe(false);
});
