import { Inject, Injectable } from "@nestjs/common";
import type { CookieOptions, Response } from "express";
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, type ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";

export const REFRESH_COOKIE_PATH = "/api/v1/auth";

@Injectable()
export class CookieService {
  constructor(@Inject(ENV) private readonly env: ServerEnv) {}

  private base(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax",
      domain: this.env.COOKIE_DOMAIN === "localhost" ? undefined : this.env.COOKIE_DOMAIN,
      path: "/",
    };
  }

  setAuthCookies(res: Response, tokens: { access: string; refresh: string; csrf: string }): void {
    res.cookie(ACCESS_COOKIE, tokens.access, {
      ...this.base(),
      maxAge: this.env.JWT_ACCESS_TTL_SECONDS * 1000,
    });
    res.cookie(REFRESH_COOKIE, tokens.refresh, {
      ...this.base(),
      path: REFRESH_COOKIE_PATH,
      maxAge: this.env.JWT_REFRESH_TTL_SECONDS * 1000,
    });
    // Readable by the browser so it can echo it in X-CSRF-Token.
    res.cookie(CSRF_COOKIE, tokens.csrf, {
      ...this.base(),
      httpOnly: false,
      maxAge: this.env.JWT_REFRESH_TTL_SECONDS * 1000,
    });
  }

  clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.base());
    res.clearCookie(REFRESH_COOKIE, { ...this.base(), path: REFRESH_COOKIE_PATH });
    res.clearCookie(CSRF_COOKIE, { ...this.base(), httpOnly: false });
  }
}
