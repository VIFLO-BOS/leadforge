import { Module } from "@nestjs/common";
import { OrgScopeGuard } from "./org-scope.guard.js";
import { PermissionsGuard } from "./permissions.guard.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";

@Module({
  imports: [OrganizationsModule],
  providers: [OrgScopeGuard, PermissionsGuard],
  exports: [OrgScopeGuard, PermissionsGuard],
})
export class AuthzModule {}
