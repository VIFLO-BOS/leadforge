import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { AuthGuard } from "./guards/auth.guard.js";
import { CsrfGuard } from "./guards/csrf.guard.js";
import { IdentityModule } from "./identity.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";

@Module({
  imports: [IdentityModule, OrganizationsModule],
  providers: [AuthService, AuthGuard, CsrfGuard],
  exports: [AuthService, AuthGuard, CsrfGuard, IdentityModule],
})
export class AuthModule {}
