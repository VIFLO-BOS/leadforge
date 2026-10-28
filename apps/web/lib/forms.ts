import type { FieldErrors, FieldValues, Path, Resolver, UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { validationDetails } from "./errors";

export type PathSegment = string | number;
export type FieldMapper<TForm extends FieldValues> = (path: PathSegment[]) => {
  field: Path<TForm>;
  prefix?: string;
};

/**
 * React Hook Form resolver for forms whose inputs do not mirror the request body one to one
 * (comma-separated lists, add/replace/remove actions). It builds the body with `toBody`,
 * validates it with the contracts schema the API also uses, and reports each issue on the
 * input `fieldFor` maps its path to. No shapes are redefined on the client.
 */
export function schemaResolver<TForm extends FieldValues>(
  schema: z.ZodType,
  toBody: (values: TForm) => unknown,
  fieldFor: FieldMapper<TForm>,
): Resolver<TForm> {
  return async (values) => {
    const parsed = schema.safeParse(toBody(values));
    if (parsed.success) return { values, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of parsed.error.issues) {
      const { field, prefix = "" } = fieldFor(issue.path as PathSegment[]);
      if (!errors[field])
        errors[field] = { type: "validation", message: `${prefix}${issue.message}` };
    }
    return { values: {}, errors: errors as FieldErrors<TForm> };
  };
}

/** Puts a 400 VALIDATION_FAILED response's details on the matching inputs. Returns true if any. */
export function applyServerErrors<TForm extends FieldValues>(
  form: UseFormReturn<TForm>,
  err: unknown,
  fieldFor: FieldMapper<TForm>,
): boolean {
  const details = validationDetails(err);
  const entries = Object.entries(details);
  for (const [path, message] of entries) {
    const segments = path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    const { field, prefix = "" } = fieldFor(segments);
    form.setError(field, { type: "server", message: `${prefix}${message}` });
  }
  return entries.length > 0;
}

/** Splits "a, b; c" or one-per-line input into trimmed, non-empty values. */
export function splitList(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}
