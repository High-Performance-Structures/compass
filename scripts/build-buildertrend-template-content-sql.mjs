import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

import { buildBuildertrendTemplatePilot } from "./lib/buildertrend-template-pilot.mjs"

function optionValue(args, option) {
  const index = args.indexOf(option)
  if (index < 0) return null
  const value = args[index + 1]
  return value && !value.startsWith("--") ? value : null
}

function sql(value) {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "number") return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function cleanText(value) {
  if (typeof value !== "string") return value
  return value
    .replace(/https?:\/\/buildertrend\.net\/\S+/gi, "")
    .replace(/Schedule Items:\s*$/g, "")
    .trim()
}

function cleanPayload(value) {
  if (Array.isArray(value)) return value.map(cleanPayload)
  if (!value || typeof value !== "object") return cleanText(value)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["href", "sourceUrl", "scheduleHref"].includes(key))
      .map(([key, nested]) => [key, cleanPayload(nested)])
  )
}

function assertItem(item, path) {
  if (!item || typeof item !== "object") throw new Error(`${path} must be an object.`)
  if (typeof item.sourceItemId !== "string" || !item.sourceItemId.trim()) {
    throw new Error(`${path}.sourceItemId is required.`)
  }
  if (typeof item.title !== "string" || !item.title.trim()) {
    throw new Error(`${path}.title is required.`)
  }
}

function assertScheduleRelationships(items, path) {
  const sourceItemIds = new Set(items.map((item) => item.sourceItemId))
  const relationshipKeys = new Set()
  for (const [itemIndex, item] of items.entries()) {
    const itemPath = `${path}[${itemIndex}]`
    if (!Array.isArray(item.predecessors)) {
      throw new Error(`${itemPath}.predecessors must be an array.`)
    }
    for (const [predecessorIndex, predecessor] of item.predecessors.entries()) {
      const predecessorPath = `${itemPath}.predecessors[${predecessorIndex}]`
      if (!predecessor || typeof predecessor !== "object" || Array.isArray(predecessor)) {
        throw new Error(`${predecessorPath} must be an object.`)
      }
      requireNonEmptyString(
        predecessor.predecessorSourceItemId,
        `${predecessorPath}.predecessorSourceItemId`
      )
      requireNonEmptyString(
        predecessor.successorSourceItemId,
        `${predecessorPath}.successorSourceItemId`
      )
      if (!sourceItemIds.has(predecessor.predecessorSourceItemId)) {
        throw new Error(
          `${predecessorPath}.predecessorSourceItemId does not identify a captured schedule item.`
        )
      }
      if (predecessor.successorSourceItemId !== item.sourceItemId) {
        throw new Error(
          `${predecessorPath}.successorSourceItemId must match its schedule item.`
        )
      }
      if (!["FS", "SS", "FF", "SF"].includes(predecessor.type)) {
        throw new Error(`${predecessorPath}.type must be FS, SS, FF, or SF.`)
      }
      if (!Number.isInteger(predecessor.lagDays)) {
        throw new Error(`${predecessorPath}.lagDays must be an integer.`)
      }
      const relationshipKey = [
        predecessor.predecessorSourceItemId,
        predecessor.successorSourceItemId,
        predecessor.type,
      ].join(":")
      if (relationshipKeys.has(relationshipKey)) {
        throw new Error(`${path} has duplicate predecessor relationship ${relationshipKey}.`)
      }
      relationshipKeys.add(relationshipKey)
    }
  }
}

function contentId(templateId, moduleType, sourceItemId) {
  const digest = createHash("sha256")
    .update(`${templateId}:${moduleType}:${sourceItemId}`)
    .digest("hex")
    .slice(0, 24)
  return `bt-template-content:${digest}`
}

const modules = [
  ["tasks", "tasks"],
  ["scheduleItems", "schedule"],
  ["selections", "selections"],
  ["bidPackages", "bid_packages"],
]

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`)
  }
}

function parseConversionExceptions(capture, capturedTemplatesById) {
  if (capture.conversionExceptions === undefined) return new Map()
  if (!Array.isArray(capture.conversionExceptions)) {
    throw new Error("capture.conversionExceptions must be an array.")
  }

  const moduleSourceKeys = new Set(modules.map(([sourceKey]) => sourceKey))
  const exceptionsByTemplateModule = new Map()
  for (const [exceptionIndex, exception] of capture.conversionExceptions.entries()) {
    const path = `capture.conversionExceptions[${exceptionIndex}]`
    if (!exception || typeof exception !== "object" || Array.isArray(exception)) {
      throw new Error(`${path} must be an object.`)
    }
    requireNonEmptyString(exception.templateSourceTemplateId, `${path}.templateSourceTemplateId`)
    requireNonEmptyString(exception.module, `${path}.module`)
    requireNonEmptyString(exception.field, `${path}.field`)
    requireNonEmptyString(exception.loss, `${path}.loss`)
    requireNonEmptyString(exception.recoveryPlan, `${path}.recoveryPlan`)
    if (!("sourceValue" in exception)) {
      throw new Error(`${path}.sourceValue is required.`)
    }
    if (!("sourceItemId" in exception)) {
      throw new Error(`${path}.sourceItemId is required; use null for a module-level exception.`)
    }
    if (exception.sourceItemId !== null) {
      requireNonEmptyString(exception.sourceItemId, `${path}.sourceItemId`)
    }
    if (!moduleSourceKeys.has(exception.module)) {
      throw new Error(
        `${path}.module must be one of tasks, scheduleItems, selections, bidPackages.`
      )
    }

    const template = capturedTemplatesById.get(exception.templateSourceTemplateId)
    if (!template) {
      throw new Error(`${path}.templateSourceTemplateId does not identify a captured template.`)
    }
    const items = template[exception.module] ?? []
    if (!Array.isArray(items)) {
      throw new Error(`${path}.module does not identify an item array on its template.`)
    }
    if (
      exception.sourceItemId !== null &&
      !items.some((item) => item?.sourceItemId === exception.sourceItemId)
    ) {
      throw new Error(
        `${path}.sourceItemId does not identify a captured ${exception.module} item.`
      )
    }

    const normalized = {
      templateSourceTemplateId: exception.templateSourceTemplateId,
      module: exception.module,
      sourceItemId: exception.sourceItemId,
      field: exception.field,
      sourceValue: exception.sourceValue,
      loss: exception.loss,
      recoveryPlan: exception.recoveryPlan,
    }
    const key = `${exception.templateSourceTemplateId}:${exception.module}`
    const current = exceptionsByTemplateModule.get(key) ?? []
    current.push(normalized)
    exceptionsByTemplateModule.set(key, current)
  }
  return exceptionsByTemplateModule
}

async function main() {
  const args = process.argv.slice(2)
  const capturePath = optionValue(args, "--capture")
  const inventoryPath = optionValue(args, "--inventory")
  const outputPath = optionValue(args, "--output")
  const pilotManifestPath = optionValue(args, "--pilot-manifest")
  const dryRun = args.includes("--dry-run")
  if (!capturePath || !inventoryPath || (!dryRun && !outputPath)) {
    throw new Error(
      "Usage: bun scripts/build-buildertrend-template-content-sql.mjs " +
        "--inventory <reviewed-inventory.json> --capture <content.json> " +
        "[--output <import.sql>] [--dry-run] [--pilot-manifest <reviewed-pilot.json>]"
    )
  }
  let capture = JSON.parse(await readFile(capturePath, "utf8"))
  let inventory = JSON.parse(await readFile(inventoryPath, "utf8"))
  let pilot = null
  if (pilotManifestPath) {
    pilot = buildBuildertrendTemplatePilot({
      inventory,
      capture,
      manifest: JSON.parse(await readFile(pilotManifestPath, "utf8")),
    })
    capture = pilot.capture
    inventory = pilot.inventory
  }
  if (!Array.isArray(capture.templates)) throw new Error("capture.templates must be an array.")
  if (!Array.isArray(inventory.templates)) {
    throw new Error("inventory.templates must be an array.")
  }

  const expectedActiveCount = Number(inventory.expectedActiveCount)
  if (!Number.isInteger(expectedActiveCount) || expectedActiveCount <= 0) {
    throw new Error("inventory.expectedActiveCount must be a positive integer.")
  }
  if (inventory.templates.length !== expectedActiveCount) {
    throw new Error(
      `Inventory count mismatch: expected ${expectedActiveCount}, found ${inventory.templates.length}.`
    )
  }

  const inventoryById = new Map()
  for (const [templateIndex, template] of inventory.templates.entries()) {
    if (!template || typeof template !== "object") {
      throw new Error(`inventory.templates[${templateIndex}] must be an object.`)
    }
    if (typeof template.sourceTemplateId !== "string" || !template.sourceTemplateId) {
      throw new Error(
        `inventory.templates[${templateIndex}].sourceTemplateId is required.`
      )
    }
    if (typeof template.name !== "string" || !template.name) {
      throw new Error(`inventory.templates[${templateIndex}].name is required.`)
    }
    if (/^archive/i.test(template.name)) {
      throw new Error(`Archived inventory template “${template.name}” is not allowed.`)
    }
    if (inventoryById.has(template.sourceTemplateId)) {
      throw new Error(`Duplicate inventory template ID ${template.sourceTemplateId}.`)
    }
    inventoryById.set(template.sourceTemplateId, template)
  }

  const capturedIds = new Set()
  const capturedTemplatesById = new Map()
  for (const [templateIndex, template] of capture.templates.entries()) {
    if (!template || typeof template !== "object") {
      throw new Error(`templates[${templateIndex}] must be an object.`)
    }
    if (typeof template.sourceTemplateId !== "string" || !template.sourceTemplateId) {
      throw new Error(`templates[${templateIndex}].sourceTemplateId is required.`)
    }
    if (capturedIds.has(template.sourceTemplateId)) {
      throw new Error(`Duplicate captured template ID ${template.sourceTemplateId}.`)
    }
    capturedIds.add(template.sourceTemplateId)
    capturedTemplatesById.set(template.sourceTemplateId, template)
  }
  const missingIds = [...inventoryById.keys()].filter((id) => !capturedIds.has(id))
  const unexpectedIds = [...capturedIds].filter((id) => !inventoryById.has(id))
  if (missingIds.length > 0 || unexpectedIds.length > 0) {
    throw new Error(
      `Template coverage mismatch: missing [${missingIds.join(", ")}], ` +
        `unexpected [${unexpectedIds.join(", ")}].`
    )
  }
  if (capture.templates.length !== expectedActiveCount) {
    throw new Error(
      `Content capture count mismatch: expected ${expectedActiveCount}, found ${capture.templates.length}.`
    )
  }
  if (capture.excludedArchivedCount !== inventory.excludedArchivedCount) {
    throw new Error(
      `Archived exclusion mismatch: expected ${inventory.excludedArchivedCount}, ` +
        `received ${capture.excludedArchivedCount}.`
    )
  }
  const exceptionsByTemplateModule = parseConversionExceptions(
    capture,
    capturedTemplatesById
  )

  const statements = ["PRAGMA foreign_keys=ON;"]
  const totals = { tasks: 0, scheduleItems: 0, selections: 0, bidPackages: 0 }
  for (const [templateIndex, template] of capture.templates.entries()) {
    if (!template || typeof template !== "object") {
      throw new Error(`templates[${templateIndex}] must be an object.`)
    }
    if (typeof template.sourceTemplateId !== "string" || !template.sourceTemplateId) {
      throw new Error(`templates[${templateIndex}].sourceTemplateId is required.`)
    }
    if (typeof template.name !== "string" || !template.name) {
      throw new Error(`templates[${templateIndex}].name is required.`)
    }
    if (/^archive/i.test(template.name)) {
      throw new Error(`Archived template “${template.name}” cannot be imported.`)
    }
    const inventoryTemplate = inventoryById.get(template.sourceTemplateId)
    if (!inventoryTemplate || inventoryTemplate.name !== template.name) {
      throw new Error(
        `Template identity mismatch for ${template.sourceTemplateId}: ` +
          `expected “${inventoryTemplate?.name ?? "unknown"}”, received “${template.name}”.`
      )
    }
    const versionId = `bt-template-version:${template.sourceTemplateId}:1`
    for (const [sourceKey, moduleType] of modules) {
      const items = template[sourceKey] ?? []
      if (!Array.isArray(items)) {
        throw new Error(`templates[${templateIndex}].${sourceKey} must be an array.`)
      }
      const expected = Number(inventoryTemplate.moduleCounts?.[sourceKey] ?? 0)
      if (items.length !== expected) {
        throw new Error(
          `${template.name} ${sourceKey} count mismatch: expected ${expected}, captured ${items.length}.`
        )
      }
      const sourceItemIds = new Set()
      for (const [itemIndex, item] of items.entries()) {
        assertItem(item, `templates[${templateIndex}].${sourceKey}[${itemIndex}]`)
        if (sourceItemIds.has(item.sourceItemId)) {
          throw new Error(
            `${template.name} ${sourceKey} has duplicate sourceItemId ${item.sourceItemId}.`
          )
        }
        sourceItemIds.add(item.sourceItemId)
      }
      if (sourceKey === "scheduleItems") {
        assertScheduleRelationships(items, `templates[${templateIndex}].scheduleItems`)
      }
      totals[sourceKey] += items.length
      const exceptions =
        exceptionsByTemplateModule.get(`${template.sourceTemplateId}:${sourceKey}`) ?? []
      statements.push(
        `DELETE FROM project_template_content_items WHERE version_id=${sql(versionId)} ` +
          `AND module_type=${sql(moduleType)} AND EXISTS (` +
          `SELECT 1 FROM project_template_versions WHERE id=${sql(versionId)} AND status='draft');`
      )
      items.forEach((item, itemIndex) => {
        const itemExceptions = exceptions.filter(
          (exception) => exception.sourceItemId === item.sourceItemId
        )
        const cleaned = cleanPayload(item)
        const payload =
          itemExceptions.length > 0
            ? { ...cleaned, conversionExceptions: itemExceptions }
            : cleaned
        const description = cleanText(
          item.description ?? item.detail?.fullText ?? item.detail?.description ?? null
        )
        statements.push(
          `INSERT INTO project_template_content_items (` +
            `id, version_id, module_type, source_item_id, parent_source_item_id, ` +
            `title, category, description, sort_order, payload_json` +
          `) SELECT ` +
            [
              sql(contentId(template.sourceTemplateId, moduleType, item.sourceItemId)),
              sql(versionId),
              sql(moduleType),
              sql(item.sourceItemId),
              sql(item.parentSourceItemId ?? null),
              sql(cleanText(item.title)),
              sql(cleanText(item.category ?? item.tags ?? null)),
              sql(description),
              Number.isInteger(item.sortOrder) ? item.sortOrder : itemIndex,
              sql(JSON.stringify(payload)),
            ].join(", ") +
            ` WHERE EXISTS (SELECT 1 FROM project_template_versions ` +
            `WHERE id=${sql(versionId)} AND status='draft');`
        )
      })
      statements.push(
        `UPDATE project_template_modules SET ` +
          `normalization_status=${sql(
            exceptions.length > 0 ? "captured_with_warnings" : "captured"
          )}, ` +
          `source_payload_json=${sql(
            JSON.stringify({
              sourceItemCount: items.length,
              capturedAt: capture.capturedAt,
              conversionExceptions: exceptions,
            })
          )} ` +
          `WHERE version_id=${sql(versionId)} AND module_type=${sql(moduleType)} ` +
          `AND EXISTS (SELECT 1 FROM project_template_versions ` +
          `WHERE id=${sql(versionId)} AND status='draft');`
      )
    }
    statements.push(
      `UPDATE project_templates SET ` +
        `review_status=CASE WHEN review_status='verified' THEN review_status ELSE 'content_captured' END, ` +
        `lifecycle_status=CASE WHEN review_status='verified' THEN lifecycle_status ELSE 'draft' END, ` +
        `source_url=NULL, updated_at=${sql(capture.capturedAt)} ` +
      `WHERE source_system='buildertrend' AND source_template_id=${sql(template.sourceTemplateId)} ` +
        `AND EXISTS (SELECT 1 FROM project_template_versions ` +
        `WHERE id=${sql(versionId)} AND status='draft');`
    )
  }

  const sqlText = `${statements.join("\n")}\n`
  if (!dryRun && outputPath) await writeFile(outputPath, sqlText, "utf8")
  console.log(
    JSON.stringify(
      {
        templateCount: capture.templates.length,
        ...totals,
        excludedArchivedCount: capture.excludedArchivedCount ?? null,
        ...(pilot
          ? {
              pilotTemplateCount: pilot.capture.templates.length,
              remainingActiveTemplatesUnverified:
                pilot.remainingActiveTemplatesUnverified,
            }
          : {}),
        output: dryRun ? null : outputPath,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
