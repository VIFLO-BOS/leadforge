import { Module } from "@nestjs/common";
import { ContactService } from "./contact.service.js";
import { PlansService } from "./plans.service.js";

@Module({ providers: [ContactService, PlansService], exports: [ContactService, PlansService] })
export class PublicModule {}
