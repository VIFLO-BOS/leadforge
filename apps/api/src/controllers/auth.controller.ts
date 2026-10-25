import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  ForgotPasswordRequest,
  LoginRequest,
  MeResponse,
  REFRESH_COOKIE,
  RegisterRequest,
  ResetPasswordRequest,
  SessionSummary,
  VerifyEmailRequest,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodResponse,
  AppError,
  AuditService,
  AuthOnly,
  AuthService,
  CookieService,
  CurrentUser,
  Public,
  SkipCsrf,
  ZodBody,
  clientIp,
  type AuthenticatedUser,
  type ClientContext,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

const AUTH_THROTTLE = { auth: { limit: 10, ttl: 60_000 } };

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
  ) {}

  @Post("register")
  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(201)
  @ApiOperation({ summary: "Create a user and their first organization" })
  @ApiZodBody(RegisterRequest)
  @ApiZodResponse(201, MeResponse)
  async register(
    @ZodBody(RegisterRequest) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { me, tokens } = await this.auth.register(body, ctx(req));
    this.cookies.setAuthCookies(res, tokens);
    return me;
  }

  @Post("login")
  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @ApiZodBody(LoginRequest)
  @ApiZodResponse(200, MeResponse)
  async login(
    @ZodBody(LoginRequest) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { me, tokens } = await this.auth.login(body, ctx(req));
    this.cookies.setAuthCookies(res, tokens);
    return me;
  }

  @Post("logout")
  @AuthOnly()
  @HttpCode(204)
  @ApiCookieAuth()
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.sessionId, user.id, ctx(req));
    this.cookies.clearAuthCookies(res);
  }

  @Post("refresh")
  @Public()
  @SkipCsrf()
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: "Rotate the refresh token and issue a new access token" })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError("UNAUTHENTICATED");
    try {
      const tokens = await this.auth.refresh(token, ctx(req));
      this.cookies.setAuthCookies(res, tokens);
      return { refreshed: true };
    } catch (err) {
      this.cookies.clearAuthCookies(res);
      throw err;
    }
  }

  @Post("verify-email")
  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @ApiZodBody(VerifyEmailRequest)
  async verifyEmail(
    @ZodBody(VerifyEmailRequest) body: VerifyEmailRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.verifyEmail(body.token, ctx(req));
    const current = (req as Request & { user?: AuthenticatedUser }).user;
    if (current && current.id === user.id) {
      const tokens = await this.auth.reissueForSession(current.sessionId, ctx(req));
      if (tokens) this.cookies.setAuthCookies(res, tokens);
    }
    return { verified: true };
  }

  @Post("resend-verification")
  @AuthOnly()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @ApiCookieAuth()
  async resendVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.resendVerification(user.id);
    return { sent: true };
  }

  @Post("forgot-password")
  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(202)
  @ApiZodBody(ForgotPasswordRequest)
  async forgotPassword(
    @ZodBody(ForgotPasswordRequest) body: ForgotPasswordRequest,
    @Req() req: Request,
  ) {
    await this.auth.forgotPassword(body.email, ctx(req));
    return { accepted: true };
  }

  @Post("reset-password")
  @Public()
  @SkipCsrf()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(200)
  @ApiZodBody(ResetPasswordRequest)
  async resetPassword(
    @ZodBody(ResetPasswordRequest) body: ResetPasswordRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.resetPassword(body.token, body.password, ctx(req));
    this.cookies.clearAuthCookies(res);
    return { reset: true };
  }

  @Get("me")
  @AuthOnly()
  @ApiCookieAuth()
  @ApiZodResponse(200, MeResponse)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Get("sessions")
  @AuthOnly()
  @ApiCookieAuth()
  @ApiZodResponse(200, SessionSummary.array())
  async sessions(@CurrentUser() user: AuthenticatedUser) {
    return paged(await this.auth.listSessions(user.id, user.sessionId));
  }

  @Delete("sessions/:id")
  @AuthOnly()
  @HttpCode(204)
  @ApiCookieAuth()
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: Request,
  ) {
    await this.auth.revokeSession(user.id, id, ctx(req));
  }
}

function ctx(req: Request): ClientContext {
  return {
    ...AuditService.contextFrom(req),
    ip: clientIp(req),
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
  };
}
