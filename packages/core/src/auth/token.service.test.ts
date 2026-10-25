import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerEnv } from "@leadforge/contracts";
import { TokenService } from "./token.service.js";

function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const enc = (k: typeof publicKey) =>
    Buffer.from(JSON.stringify(k.export({ format: "jwk" }))).toString("base64url");
  return { JWT_PRIVATE_KEY: enc(privateKey), JWT_PUBLIC_KEY: enc(publicKey) };
}

let svc: TokenService;

beforeAll(async () => {
  svc = new TokenService({ ...keys(), JWT_ACCESS_TTL_SECONDS: 60 } as ServerEnv);
  await svc.onModuleInit();
});

describe("TokenService", () => {
  it("signs and verifies access tokens with claims", async () => {
    const token = await svc.signAccessToken({ sub: "user-1", sid: "sess-1", ev: true });
    const claims = await svc.verifyAccessToken(token);
    expect(claims).toEqual({ sub: "user-1", sid: "sess-1", ev: true });
  });

  it("rejects tokens signed by another key", async () => {
    const other = new TokenService({ ...keys(), JWT_ACCESS_TTL_SECONDS: 60 } as ServerEnv);
    await other.onModuleInit();
    const token = await other.signAccessToken({ sub: "u", sid: "s", ev: false });
    await expect(svc.verifyAccessToken(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("reports expiry distinctly", async () => {
    const short = new TokenService({ ...keys(), JWT_ACCESS_TTL_SECONDS: 60 } as ServerEnv);
    await short.onModuleInit();
    // Build an already-expired token by signing with a negative TTL through a sibling instance.
    const expiredSvc = new TokenService({ ...keys(), JWT_ACCESS_TTL_SECONDS: -120 } as ServerEnv);
    await expiredSvc.onModuleInit();
    const token = await expiredSvc.signAccessToken({ sub: "u", sid: "s", ev: true });
    await expect(expiredSvc.verifyAccessToken(token)).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
  });

  it("issues refresh tokens whose stored hash never contains the secret", () => {
    const { token, hash } = svc.issueRefreshToken("0193c4c2-1234-7abc-8def-0123456789ab");
    expect(token.startsWith("0193c4c2-1234-7abc-8def-0123456789ab.")).toBe(true);
    expect(token).not.toContain(hash);
    const parsed = svc.parseRefreshToken(token);
    expect(parsed?.hash).toBe(hash);
    expect(svc.parseRefreshToken("garbage")).toBeNull();
    expect(svc.parseRefreshToken("0193c4c2-1234-7abc-8def-0123456789ab.short")).toBeNull();
  });
});
