import { describe, expect, it } from "vitest";
import type { ServerEnv } from "@leadforge/contracts";
import { CsrfService } from "./csrf.service.js";

const env = { CSRF_SECRET: "0123456789abcdef0123456789abcdef" } as ServerEnv;

describe("CsrfService", () => {
  it("binds the token to the session id", () => {
    const svc = new CsrfService(env);
    const token = svc.tokenFor("session-a");
    expect(svc.matches("session-a", token)).toBe(true);
    expect(svc.matches("session-b", token)).toBe(false);
    expect(svc.matches("session-a", undefined)).toBe(false);
    expect(svc.matches("session-a", `${token}x`)).toBe(false);
  });

  it("changes with the secret", () => {
    const a = new CsrfService(env).tokenFor("s");
    const b = new CsrfService({
      CSRF_SECRET: "another-secret-another-secret-123456",
    } as ServerEnv).tokenFor("s");
    expect(a).not.toBe(b);
  });
});
