import { z } from "zod"
import type { DataSource } from "../types"

export interface ToolDef {
  readonly name: string
  readonly description: string
  readonly input_schema: Record<string, unknown>
  readonly run: (input: unknown) => Promise<string>
}

const queryDataSchema = z.object({
  queryType: z.enum([
    "customers",
    "vendors",
    "projects",
    "invoices",
    "vendor_bills",
    "schedule_tasks",
    "project_operations",
    "project_detail",
    "customer_detail",
    "vendor_detail",
  ]),
  id: z.string().optional().describe("Record ID for detail queries"),
  search: z
    .string()
    .optional()
    .describe("Search term to filter results"),
  limit: z
    .number()
    .optional()
    .describe("Max results to return (default 20)"),
})

export function dataTools(dataSource: DataSource): ToolDef[] {
  return [
    {
      name: "queryData",
      description:
        "Query the application database. Describe what data " +
        "you need in natural language and provide a query type.",
      input_schema: zodToJsonSchema(queryDataSchema),
      run: async (input: unknown): Promise<string> => {
        const args = queryDataSchema.parse(input)
        const result = await dataSource.fetch(
          "/api/compass/query",
          args
        )
        return JSON.stringify(result)
      },
    },
  ]
}

/** Minimal zod-to-JSON-schema converter for our tool schemas */
export function zodToJsonSchema(
  schema: z.ZodObject<z.ZodRawShape>
): Record<string, unknown> {
  const jsonSchema = zodObjectToProperties(schema)
  return {
    type: "object",
    properties: jsonSchema.properties,
    required: jsonSchema.required,
  }
}

function zodObjectToProperties(schema: z.ZodObject<z.ZodRawShape>): {
  properties: Record<string, unknown>
  required: string[]
} {
  const shape = schema.shape
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    const { schema: propSchema, isOptional } = unwrapOptional(
      value as z.ZodType
    )
    properties[key] = zodTypeToJsonSchema(propSchema)
    if (!isOptional) {
      required.push(key)
    }
  }

  return { properties, required }
}

function unwrapOptional(
  schema: z.ZodType
): { schema: z.ZodType; isOptional: boolean } {
  if (schema instanceof z.ZodOptional) {
    return { schema: schema.unwrap(), isOptional: true }
  }
  if (schema instanceof z.ZodNullable) {
    return { schema: schema.unwrap(), isOptional: true }
  }
  return { schema, isOptional: false }
}

function zodTypeToJsonSchema(
  schema: z.ZodType
): Record<string, unknown> {
  const desc = schema.description

  if (schema instanceof z.ZodString) {
    return { type: "string", ...(desc ? { description: desc } : {}) }
  }
  if (schema instanceof z.ZodNumber) {
    const result: Record<string, unknown> = {
      type: "number",
      ...(desc ? { description: desc } : {}),
    }
    const checks = (schema as z.ZodNumber)._def.checks
    for (const check of checks) {
      if (check.kind === "min") result.minimum = check.value
      if (check.kind === "max") result.maximum = check.value
    }
    return result
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean", ...(desc ? { description: desc } : {}) }
  }
  if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: schema.options,
      ...(desc ? { description: desc } : {}),
    }
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodTypeToJsonSchema(schema.element),
      ...(desc ? { description: desc } : {}),
    }
  }
  if (schema instanceof z.ZodObject) {
    const inner = zodObjectToProperties(schema)
    return {
      type: "object",
      properties: inner.properties,
      required: inner.required,
      ...(desc ? { description: desc } : {}),
    }
  }
  if (schema instanceof z.ZodRecord) {
    return {
      type: "object",
      additionalProperties: zodTypeToJsonSchema(schema.element),
      ...(desc ? { description: desc } : {}),
    }
  }
  if (schema instanceof z.ZodNullable) {
    const inner = zodTypeToJsonSchema(schema.unwrap())
    return { ...inner, nullable: true }
  }
  if (schema instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(schema.unwrap())
  }

  // Fallback
  return { ...(desc ? { description: desc } : {}) }
}
