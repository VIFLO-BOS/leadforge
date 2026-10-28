import { Module } from "@nestjs/common";
import { EntitlementsService } from "./entitlements.service.js";
import { EntitlementRepository } from "./repositories/entitlement.repository.js";

/** Plan-dependent limits (export row cap now; member cap and feature flags in Phase 6). */
@Module({ providers: [EntitlementsService, EntitlementRepository], exports: [EntitlementsService] })
export class EntitlementsModule {}
