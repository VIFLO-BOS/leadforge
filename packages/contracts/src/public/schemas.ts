import { z } from "zod";
import { Email } from "../auth/schemas.js";

export const ContactRequest = z.object({
  name: z.string().trim().min(1).max(120),
  email: Email,
  company: z.string().trim().max(120).optional(),
  message: z.string().trim().min(10).max(4000),
  kind: z.enum(["contact", "data_request"]).default("contact"),
  /** Honeypot. Must stay empty; bots that fill it are silently accepted and dropped. */
  website: z.string().max(0).optional(),
});
export type ContactRequest = z.infer<typeof ContactRequest>;

export const PlanInterval = z.enum(["monthly", "yearly"]);

export const PublicPlan = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  interval: PlanInterval,
  priceMinor: z.number().int(),
  currency: z.string(),
  includedCredits: z.number().int(),
  maxMembers: z.number().int(),
  exportRowCap: z.number().int(),
  isPlaceholder: z.boolean(),
});
export type PublicPlan = z.infer<typeof PublicPlan>;

export const PublicCreditPack = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  credits: z.number().int(),
  priceMinor: z.number().int(),
  currency: z.string(),
  isPlaceholder: z.boolean(),
});
export type PublicCreditPack = z.infer<typeof PublicCreditPack>;

export const PublicPlansResponse = z.object({
  plans: z.array(PublicPlan),
  creditPacks: z.array(PublicCreditPack),
  /** True when any displayed price is a placeholder; the UI must say pricing is not final. */
  pricingPublished: z.boolean(),
});
export type PublicPlansResponse = z.infer<typeof PublicPlansResponse>;
