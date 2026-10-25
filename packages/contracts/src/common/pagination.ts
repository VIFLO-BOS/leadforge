import { z } from "zod";

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

export const CursorQuery = z.object({
  cursor: z.string().max(512).optional(),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

/** Build a sort query schema from an allowlist of sortable fields, e.g. "name:asc". */
export function sortQuery<const F extends readonly [string, ...string[]]>(fields: F) {
  const pattern = new RegExp(`^(${fields.join("|")}):(asc|desc)$`);
  return z
    .string()
    .regex(pattern, `sort must be one of ${fields.join(", ")} followed by :asc or :desc`)
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const [field, direction] = value.split(":") as [F[number], "asc" | "desc"];
      return { field, direction };
    });
}
