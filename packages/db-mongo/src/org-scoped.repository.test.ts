import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { decodeCursor, encodeCursor } from "./org-scoped.repository.js";

describe("cursor encoding", () => {
  it("round-trips a date sort value and id", () => {
    const id = new ObjectId();
    const when = new Date("2026-10-24T12:00:00.000Z");
    const cursor = encodeCursor(when, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.[1]).toBe(id.toHexString());
    expect(decoded?.[0]).toEqual({ $date: when.toISOString() });
  });

  it("rejects garbage cursors instead of throwing", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from("[1,2,3]").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('["x","nothex"]').toString("base64url"))).toBeNull();
  });
});
