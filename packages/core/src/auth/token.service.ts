import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { importJWK, jwtVerify, SignJWT, type JWK } from "jose";

type ImportedKey = Awaited<ReturnType<typeof importJWK>>;
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  ev: boolean;
}

const ALG = "EdDSA";
const ISSUER = "leadforge";
const AUDIENCE = "leadforge-api";

/**
 * Access tokens are short-lived EdDSA JWTs. Refresh tokens are opaque:
 * "<sessionId>.<secret>", with only sha256(secret) stored.
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey: ImportedKey | null = null;
  private publicKey!: ImportedKey;

  constructor(@Inject(ENV) private readonly env: ServerEnv) {}

  async onModuleInit(): Promise<void> {
    // The worker runs without the signing key (it never issues tokens); the API requires it at boot.
    this.privateKey = this.env.JWT_PRIVATE_KEY
      ? await importJWK(decodeJwk(this.env.JWT_PRIVATE_KEY), ALG)
      : null;
    this.publicKey = await importJWK(decodeJwk(this.env.JWT_PUBLIC_KEY), ALG);
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    if (!this.privateKey)
      throw new Error(
        "JWT_PRIVATE_KEY is not set in this process; only the API signs access tokens",
      );
    return new SignJWT({ sid: claims.sid, ev: claims.ev })
      .setProtectedHeader({ alg: ALG, typ: "JWT" })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: [ALG],
      });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
        throw new AppError("UNAUTHENTICATED");
      }
      return { sub: payload.sub, sid: payload.sid, ev: payload.ev === true };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const code = (err as { code?: string }).code;
      if (code === "ERR_JWT_EXPIRED") throw new AppError("TOKEN_EXPIRED");
      throw new AppError("UNAUTHENTICATED");
    }
  }

  /** Returns the opaque refresh token for the client and the hash to persist. */
  issueRefreshToken(sessionId: string): { token: string; hash: string } {
    const secret = randomBytes(32).toString("base64url");
    return { token: `${sessionId}.${secret}`, hash: hashSecret(secret) };
  }

  parseRefreshToken(token: string): { sessionId: string; hash: string } | null {
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || secret.length < 32) return null;
    return { sessionId, hash: hashSecret(secret) };
  }

  /** One-time tokens for email links. Only the hash is stored. */
  issueOneTimeToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: hashSecret(token) };
  }

  hashOneTimeToken(token: string): string {
    return hashSecret(token);
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeJwk(encoded: string): JWK {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as JWK;
  } catch {
    throw new Error("JWT key is not a base64url-encoded JWK. Run pnpm gen:keys.");
  }
}
