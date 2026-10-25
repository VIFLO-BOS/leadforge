import { Injectable } from "@nestjs/common";
import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

/** Simple, dependency-free weakness check in addition to the length rule from contracts. */
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "qwertyuiop",
  "1234567890",
  "12345678910",
  "abcdefghij",
  "iloveyou123",
  "letmein123",
  "welcome123",
  "admin12345",
  "leadforge123",
]);

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Returns a problem description or null when the password is acceptable. */
  weakness(plain: string, context: { email?: string; name?: string } = {}): string | null {
    const lower = plain.toLowerCase();
    if (COMMON_PASSWORDS.has(lower)) return "That password is too common";
    if (/^(.)\1+$/.test(plain)) return "Use more than one distinct character";
    if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(lower))
      return "Avoid keyboard sequences";
    const emailLocal = context.email?.split("@")[0]?.toLowerCase();
    if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal)) {
      return "Do not use your email address in your password";
    }
    const name = context.name?.toLowerCase().trim();
    if (name && name.length >= 4 && lower.includes(name))
      return "Do not use your name in your password";
    return null;
  }
}
