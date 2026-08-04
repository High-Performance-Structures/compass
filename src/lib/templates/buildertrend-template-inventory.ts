import { createHash } from "node:crypto"

export type BuildertrendTemplateInventoryItem = {
  readonly name: string
  readonly tradeCategory: string
  readonly templateKind: "assembly" | "project"
  readonly departmentCode: string | null
  readonly sourceTemplateId: string | null
  readonly sourceUrl: string | null
}

export type BuildertrendTemplateInventory = {
  readonly capturedAt: string
  readonly sourceUrl: string
  readonly expectedActiveCount: number
  readonly excludedArchivedCount: number
  readonly templates: readonly BuildertrendTemplateInventoryItem[]
}

export type BuildertrendTemplateInventoryParseResult =
  | { readonly success: true; readonly data: BuildertrendTemplateInventory }
  | { readonly success: false; readonly errors: readonly string[] }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function optionalStringValue(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function integerValue(
  record: Readonly<Record<string, unknown>>,
  key: string
): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null
}

export function isArchivedBuildertrendTemplateName(name: string): boolean {
  return /^archive(?:d)?\b/i.test(name.trim())
}

function templateKind(value: unknown): "assembly" | "project" | null {
  if (value === "assembly" || value === "project") return value
  return null
}

export function parseBuildertrendTemplateInventory(
  value: unknown
): BuildertrendTemplateInventoryParseResult {
  if (!isRecord(value)) {
    return { success: false, errors: ["Inventory must be a JSON object."] }
  }

  const capturedAt = stringValue(value, "capturedAt")
  const sourceUrl = stringValue(value, "sourceUrl")
  const expectedActiveCount = integerValue(value, "expectedActiveCount")
  const excludedArchivedCount = integerValue(value, "excludedArchivedCount")
  const templateValues = value.templates
  const errors: string[] = []
  if (!capturedAt || Number.isNaN(new Date(capturedAt).getTime())) {
    errors.push("capturedAt must be a valid ISO timestamp.")
  }
  if (!sourceUrl) errors.push("sourceUrl is required.")
  if (expectedActiveCount === null) {
    errors.push("expectedActiveCount must be a nonnegative integer.")
  }
  if (excludedArchivedCount === null) {
    errors.push("excludedArchivedCount must be a nonnegative integer.")
  }
  if (!Array.isArray(templateValues)) {
    errors.push("templates must be an array.")
  }
  if (errors.length > 0 || !Array.isArray(templateValues)) {
    return { success: false, errors }
  }

  const templates: BuildertrendTemplateInventoryItem[] = []
  const seenNames = new Set<string>()
  templateValues.forEach((itemValue, index) => {
    if (!isRecord(itemValue)) {
      errors.push(`templates[${index}] must be an object.`)
      return
    }
    const name = stringValue(itemValue, "name")
    const tradeCategory = stringValue(itemValue, "tradeCategory")
    const kind = templateKind(itemValue.templateKind)
    const sourceStatus = optionalStringValue(itemValue, "sourceStatus")
    const sourceMarksArchived =
      itemValue.archived === true ||
      sourceStatus?.toLocaleLowerCase("en-US") === "archived" ||
      sourceStatus?.toLocaleLowerCase("en-US") === "inactive" ||
      sourceStatus?.toLocaleLowerCase("en-US") === "deleted"
    if (!name) errors.push(`templates[${index}].name is required.`)
    if (!tradeCategory) {
      errors.push(`templates[${index}].tradeCategory is required.`)
    }
    if (!kind) {
      errors.push(`templates[${index}].templateKind is unsupported.`)
    }
    if (!name || !tradeCategory || !kind) return
    if (isArchivedBuildertrendTemplateName(name) || sourceMarksArchived) {
      errors.push(
        `Archived template “${name}” is forbidden in the active import.`
      )
      return
    }
    const normalizedName = name.toLocaleLowerCase("en-US")
    if (seenNames.has(normalizedName)) {
      errors.push(`Duplicate active template name: “${name}”.`)
      return
    }
    seenNames.add(normalizedName)
    templates.push({
      name,
      tradeCategory,
      templateKind: kind,
      departmentCode: optionalStringValue(itemValue, "departmentCode"),
      sourceTemplateId: optionalStringValue(itemValue, "sourceTemplateId"),
      sourceUrl: optionalStringValue(itemValue, "sourceUrl"),
    })
  })

  if (
    expectedActiveCount !== null &&
    templates.length !== expectedActiveCount
  ) {
    errors.push(
      `Expected ${expectedActiveCount} active templates but found ${templates.length}.`
    )
  }
  if (errors.length > 0) return { success: false, errors }

  return {
    success: true,
    data: {
      capturedAt: capturedAt ?? "",
      sourceUrl: sourceUrl ?? "",
      expectedActiveCount: expectedActiveCount ?? 0,
      excludedArchivedCount: excludedArchivedCount ?? 0,
      templates,
    },
  }
}

function sql(value: string | number | null): string {
  if (value === null) return "NULL"
  if (typeof value === "number") return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

function templateSourceKey(name: string): string {
  const slug = name
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 10)
  return `template:${slug}:${suffix}`
}

export function buildBuildertrendTemplateInventorySql(
  organizationId: string,
  inventory: BuildertrendTemplateInventory
): { readonly sql: string; readonly importedCount: number } {
  const statements = inventory.templates.map((template) => {
    const sourceKey = templateSourceKey(template.name)
    const id = `bt-${sourceKey}`
    const sourceMetadata = JSON.stringify({
      inventoryCapturedAt: inventory.capturedAt,
      excludedArchivedTemplateCount: inventory.excludedArchivedCount,
      contentCaptureStatus: "pending",
    })
    return (
      `INSERT INTO project_templates (` +
      `id, organization_id, source_system, source_key, source_template_id, ` +
      `source_url, name, template_kind, department_code, trade_category, ` +
      `lifecycle_status, review_status, source_metadata_json, created_at, updated_at` +
      `) VALUES (` +
      [
        sql(id),
        sql(organizationId),
        sql("buildertrend"),
        sql(sourceKey),
        sql(template.sourceTemplateId),
        sql(null),
        sql(template.name),
        sql(template.templateKind),
        // Department/branding is selected by the destination project, not the template.
        sql(null),
        sql(template.tradeCategory),
        sql("draft"),
        sql("inventory_only"),
        sql(sourceMetadata),
        sql(inventory.capturedAt),
        sql(inventory.capturedAt),
      ].join(", ") +
      `) ON CONFLICT(organization_id, source_system, source_key) DO UPDATE SET ` +
      `source_template_id=excluded.source_template_id, ` +
      `source_url=NULL, name=excluded.name, ` +
      `template_kind=excluded.template_kind, ` +
      `department_code=project_templates.department_code, ` +
      `trade_category=excluded.trade_category, ` +
      `source_metadata_json=excluded.source_metadata_json, ` +
      `updated_at=excluded.updated_at;`
    )
  })

  return {
    sql:
      `-- Buildertrend active template inventory captured ${inventory.capturedAt}\n` +
      `-- ${inventory.excludedArchivedCount} archived templates were excluded; no archived rows are emitted.\n` +
      `${statements.join("\n")}\n`,
    importedCount: statements.length,
  }
}
