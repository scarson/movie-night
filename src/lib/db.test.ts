// ABOUTME: Tests for sqliteIsoNow (ISO 8601 strftime SQL fragment) and parseJsonColumn.
// ABOUTME: sqliteIsoNow is verified as a string builder; the actual strftime output is exercised via fake-D1 in Task 1.4+.
import { describe, expect, it } from "vitest";
import { parseJsonColumn, sqliteIsoNow } from "./db";

describe("sqliteIsoNow", () => {
  it("returns a strftime expression producing ISO 8601 (T-separated) timestamps", () => {
    expect(sqliteIsoNow()).toBe("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });

  it("embeds a modifier when one is passed", () => {
    expect(sqliteIsoNow("-7 days")).toBe("strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')");
  });
});

describe("parseJsonColumn", () => {
  it("returns the parsed value for valid JSON", () => {
    expect(parseJsonColumn<string[]>('["a","b"]', [])).toEqual(["a", "b"]);
    expect(parseJsonColumn<{ x: number }>('{"x":1}', { x: 0 })).toEqual({ x: 1 });
  });

  it("returns the fallback for null", () => {
    expect(parseJsonColumn<string[]>(null, ["fallback"])).toEqual(["fallback"]);
  });

  it("returns the fallback for undefined", () => {
    expect(parseJsonColumn<string[]>(undefined, ["fallback"])).toEqual(["fallback"]);
  });

  it("returns the fallback for garbage JSON", () => {
    expect(parseJsonColumn<string[]>("not json", ["fallback"])).toEqual(["fallback"]);
    expect(parseJsonColumn<string[]>("{broken", ["fallback"])).toEqual(["fallback"]);
  });

  it("returns the fallback for an empty string", () => {
    expect(parseJsonColumn<string[]>("", ["fallback"])).toEqual(["fallback"]);
  });

  it("returns valid JSON's falsy/empty values instead of the fallback", () => {
    expect(parseJsonColumn<string[]>("[]", ["fallback"])).toEqual([]);
    expect(parseJsonColumn<number>("0", -1)).toBe(0);
  });
});
