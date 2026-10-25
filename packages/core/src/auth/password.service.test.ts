import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service.js";

const svc = new PasswordService();

describe("PasswordService", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await svc.hash("Correct-Horse-Battery-9");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await svc.verify(hash, "Correct-Horse-Battery-9")).toBe(true);
    expect(await svc.verify(hash, "wrong")).toBe(false);
    expect(await svc.verify("not-a-hash", "wrong")).toBe(false);
  });

  it("flags common, repetitive and personal passwords", () => {
    expect(svc.weakness("password123")).toMatch(/common/);
    expect(svc.weakness("aaaaaaaaaaaa")).toMatch(/distinct/);
    expect(svc.weakness("qwertyuiop12")).toMatch(/sequence/);
    expect(svc.weakness("ada.lovelace-rocks", { email: "ada.lovelace@example.test" })).toMatch(
      /email/,
    );
    expect(svc.weakness("Grace Hopper 1906", { name: "Grace Hopper" })).toMatch(/name/);
    expect(svc.weakness("Correct-Horse-Battery-9", { email: "x@y.z", name: "Zed" })).toBeNull();
  });
});
