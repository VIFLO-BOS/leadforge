import { createHmac, timingSafeEqual } from "node:crypto";

export interface DownloadClaims {
  organizationId: string;
  exportId: string;
  userId: string;
  /** Unix seconds. */
  expires: number;
}

export type DownloadCheck = { ok: true } | { ok: false; reason: "invalid" | "expired" };

/**
 * HMAC-SHA256 signatures for export download links. A link names one export, one organization
 * and the user it was issued to, and an expiry; changing any of them breaks the signature.
 */
export class DownloadSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32)
      throw new Error("The download signing secret needs at least 32 characters");
    this.key = Buffer.from(secret, "utf8");
  }

  /** Derives the signing key from another secret with a fixed label (used when EXPORT_SIGNING_SECRET is unset). */
  static derived(baseSecret: string): DownloadSigner {
    return new DownloadSigner(
      createHmac("sha256", baseSecret).update("leadforge:export-download:v1").digest("hex"),
    );
  }

  sign(claims: DownloadClaims): string {
    return createHmac("sha256", this.key)
      .update(
        `v1\n${claims.organizationId}\n${claims.exportId}\n${claims.userId}\n${claims.expires}`,
      )
      .digest("base64url");
  }

  /** Signature first (a tampered link is invalid even if it is also old), then expiry. */
  verify(
    claims: DownloadClaims,
    signature: string,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): DownloadCheck {
    const expected = Buffer.from(this.sign(claims), "utf8");
    const given = Buffer.from(signature, "utf8");
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return { ok: false, reason: "invalid" };
    if (claims.expires < nowSeconds) return { ok: false, reason: "expired" };
    return { ok: true };
  }
}
