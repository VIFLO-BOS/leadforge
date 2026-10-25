import { z } from "zod";

export const PageMeta = z.object({
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable().optional(),
  pageSize: z.number().int(),
  total: z.number().int().optional(),
  totalApprox: z.number().int().optional(),
});
export type PageMeta = z.infer<typeof PageMeta>;

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: PageMeta.optional() });
}

export type Envelope<T> = { data: T; meta?: PageMeta };
export type PagedEnvelope<T> = { data: T[]; meta: PageMeta };
