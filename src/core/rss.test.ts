import { describe, expect, it } from "vitest";
import { parseDuration } from "./rss";

describe("parseDuration", () => {
  it("parses seconds and human-readable podcast durations", () => {
    expect(parseDuration("42")).toBe(42);
    expect(parseDuration("03:45")).toBe(225);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("2h3m4s")).toBe(7384);
  });

  it("rejects invalid clock-style durations", () => {
    expect(parseDuration("1:75")).toBeUndefined();
    expect(parseDuration("1:02:75")).toBeUndefined();
  });
});
