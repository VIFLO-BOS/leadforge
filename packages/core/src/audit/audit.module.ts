import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { AuditRepository } from "./repositories/audit.repository.js";

@Global()
@Module({ providers: [AuditRepository, AuditService], exports: [AuditService, AuditRepository] })
export class AuditModule {}
