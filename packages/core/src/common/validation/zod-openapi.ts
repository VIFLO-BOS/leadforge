import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { z, type ZodType } from "zod";

type SchemaObject = Record<string, unknown>;

function toSchema(schema: ZodType): SchemaObject {
  const json = z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
  }) as SchemaObject;
  delete json.$schema;
  return json;
}

/** Documents a Zod request body in Swagger. Pair with ZodBody for validation. */
export const ApiZodBody = (schema: ZodType, description?: string) =>
  applyDecorators(ApiBody({ schema: toSchema(schema) as never, description }));

/** Documents a Zod response (wrapped in the data envelope). */
export const ApiZodResponse = (status: number, schema: ZodType, description?: string) =>
  applyDecorators(
    ApiResponse({
      status,
      description,
      schema: { type: "object", properties: { data: toSchema(schema) as never } },
    }),
  );

/** Documents each top-level key of a Zod object schema as a query parameter. */
export const ApiZodQuery = (schema: ZodType) => {
  const json = toSchema(schema);
  const properties = (json.properties ?? {}) as Record<string, SchemaObject>;
  const required = new Set((json.required as string[] | undefined) ?? []);
  return applyDecorators(
    ...Object.entries(properties).map(([name, prop]) =>
      ApiQuery({ name, required: required.has(name), schema: prop as never }),
    ),
  );
};
