import { Body, Param, Query, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import type { ErrorDetail } from "@leadforge/contracts";
import { AppError } from "../errors/app.error.js";

/** Validates and transforms input with a Zod schema; unknown keys are stripped. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join(".") || "(root)",
      message: issue.message,
    }));
    throw AppError.validation(details);
  }
}

export const ZodBody = <T>(schema: ZodType<T>) => Body(new ZodValidationPipe(schema));
export const ZodQuery = <T>(schema: ZodType<T>) => Query(new ZodValidationPipe(schema));
export const ZodParam = <T>(name: string, schema: ZodType<T>) =>
  Param(name, new ZodValidationPipe(schema));
