import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { REDIS } from "../redis/redis.module.js";

/** Failed sign-ins allowed per account in one window before the account is throttled. */
export const LOGIN_FAILURES_PER_ACCOUNT = 10;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

/** INCR, and start the window when the key has no expiry yet (first failure). */
const RECORD_FAILURE_SCRIPT = `
  local n = redis.call('INCR', KEYS[1])
  if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return n
`;

/**
 * Redis-backed controls that complement the PostgreSQL session rows:
 *
 * - Immediate revocation of access tokens. Access JWTs are stateless (15 minutes), so a session
 *   revoked by sign-out, "sign out this device", a password reset or refresh-token reuse
 *   detection is also written here, and AuthGuard refuses its access token at once instead of
 *   when it expires. Keys live as long as an access token can (JWT_ACCESS_TTL_SECONDS plus a
 *   minute of clock skew). Routine refresh-token rotation is not a revocation and is not listed.
 * - Per-account sign-in throttling (docs/SECURITY_AND_DATA_COLLECTION.md section 1): at most
 *   LOGIN_FAILURES_PER_ACCOUNT failed attempts per account per 15 minutes, whatever the source
 *   address, on top of the per-IP route limit. Keys hold a hash of the normalized email only.
 */
@Injectable()
export class SessionSecurityService {
  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async markRevoked(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    const ttl = this.env.JWT_ACCESS_TTL_SECONDS + 60;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) pipeline.set(revokedKey(id), "1", "EX", ttl);
    await pipeline.exec();
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(revokedKey(sessionId))) === 1;
  }

  /**
   * Seconds until the account's sign-in lock lifts, or 0 when it is not locked. The window is
   * fixed from the first failure and attempts refused while locked are not counted, so the key's
   * TTL is exactly the time left. Keyed on the email whether or not an account exists, so the
   * answer is the same for unknown addresses.
   */
  async loginLockSeconds(email: string): Promise<number> {
    const key = loginKey(email);
    const result = await this.redis.multi().get(key).ttl(key).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    const ttl = Number(result?.[1]?.[1] ?? -2);
    if (!Number.isFinite(count) || count < LOGIN_FAILURES_PER_ACCOUNT) return 0;
    if (ttl > 0) return ttl;
    if (ttl === -1) {
      // A counter without an expiry (written by an older version between INCR and EXPIRE) would
      // lock the account for good: give it a full window instead.
      await this.redis.expire(key, LOGIN_FAILURE_WINDOW_SECONDS);
      return LOGIN_FAILURE_WINDOW_SECONDS;
    }
    return 0; // expired between the two reads
  }

  /** True when the account has used up its failed sign-in budget for the current window. */
  async loginLocked(email: string): Promise<boolean> {
    return (await this.loginLockSeconds(email)) > 0;
  }

  /** Counts a failure; the first one starts the window (atomically, so a counter never lacks an expiry). */
  async recordLoginFailure(email: string): Promise<void> {
    await this.redis.eval(
      RECORD_FAILURE_SCRIPT,
      1,
      loginKey(email),
      String(LOGIN_FAILURE_WINDOW_SECONDS),
    );
  }

  async clearLoginFailures(email: string): Promise<void> {
    await this.redis.del(loginKey(email));
  }
}

function revokedKey(sessionId: string): string {
  return `lf:session-revoked:${sessionId}`;
}

function loginKey(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
  return `lf:login-failures:${digest}`;
}
