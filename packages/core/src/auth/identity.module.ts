import { Global, Module } from "@nestjs/common";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
import { CookieService } from "./cookie.service.js";
import { CsrfService } from "./csrf.service.js";
import { UserRepository } from "./repositories/user.repository.js";
import { SessionRepository } from "./repositories/session.repository.js";
import { EmailTokenRepository } from "./repositories/email-token.repository.js";

/** Low-level identity primitives shared by auth, organizations and authz. */
@Global()
@Module({
  providers: [
    PasswordService,
    TokenService,
    CookieService,
    CsrfService,
    UserRepository,
    SessionRepository,
    EmailTokenRepository,
  ],
  exports: [
    PasswordService,
    TokenService,
    CookieService,
    CsrfService,
    UserRepository,
    SessionRepository,
    EmailTokenRepository,
  ],
})
export class IdentityModule {}
