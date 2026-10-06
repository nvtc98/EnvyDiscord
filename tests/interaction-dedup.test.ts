import { beforeEach, describe, expect, it } from "vitest";
import {
  resetSeenInteractions,
  seenInteraction,
} from "../src/discord/interaction-dedup";

beforeEach(() => {
  resetSeenInteractions();
});

describe("seenInteraction (dispatcher idempotency)", () => {
  it("reports a never-seen id as new, then as a duplicate", () => {
    expect(seenInteraction("i-1")).toBe(false); // first time: dispatch it
    expect(seenInteraction("i-1")).toBe(true); // redelivery: drop it
    expect(seenInteraction("i-1")).toBe(true); // still a duplicate
  });

  it("tracks distinct ids independently", () => {
    expect(seenInteraction("a")).toBe(false);
    expect(seenInteraction("b")).toBe(false);
    expect(seenInteraction("a")).toBe(true);
    expect(seenInteraction("b")).toBe(true);
    expect(seenInteraction("c")).toBe(false);
  });

  it("is bounded: the oldest ids are evicted once over the cap", () => {
    // Fill well past the cap, then confirm the newest ids are still deduped while a long-evicted one
    // is treated as new again (the set cannot grow unbounded in a long-running process).
    for (let i = 0; i < 600; i++) expect(seenInteraction(`k-${i}`)).toBe(false);
    // The most recent ids are retained.
    expect(seenInteraction("k-599")).toBe(true);
    // The very first id has been evicted, so it looks new again.
    expect(seenInteraction("k-0")).toBe(false);
  });

  it("resetSeenInteractions clears the record", () => {
    expect(seenInteraction("x")).toBe(false);
    expect(seenInteraction("x")).toBe(true);
    resetSeenInteractions();
    expect(seenInteraction("x")).toBe(false);
  });
});
