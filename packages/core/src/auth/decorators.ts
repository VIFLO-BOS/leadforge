import { createParamDecorator, SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedUser, RequestWithContext } from "../common/request/request-context.js";

export const IS_PUBLIC_KEY = "lf:public";
/** Route needs no authentication. Still rate limited. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const AUTH_ONLY_KEY = "lf:auth-only";
/** Route needs an authenticated user but no organization scope (e.g. /auth/me). */
export const AuthOnly = () => SetMetadata(AUTH_ONLY_KEY, true);

export const SKIP_CSRF_KEY = "lf:skip-csrf";
/** Exempt from CSRF (webhooks, login). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!req.user) throw new Error("CurrentUser used on a route without AuthGuard");
    return req.user;
  },
);
