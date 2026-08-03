import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

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

function contentId(templateId, moduleType, sourceItemId) {
  const digest = createHash("sha256")
    .update(`${templateId}:${moduleType}:${sourceItemId}`)
    .digest("hex")
    .slice(0, 24)
  return `bt-template-content:${digest}`
}

async function main() {
  const args = process.argv.slice(2)
  const capturePath = optionValue(args, "--capture")
  const outputPath = optionValue(args, "--output")
  const dryRun = args.includes("--dry-run")
  if (!capturePath || (!dryRun && !outputPath)) {
    throw new Error(
      "Usage: bun scripts/build-buildertrend-template-content-sql.mjs " +
        "--capture <content.json> [--output <import.sql>] [--dry-run]"
    )
  }
  const capture = JSON.parse(await readFile(capturePath, "utf8"))
  if (!Array.isArray(capture.templates)) throw new Error("capture.templates must be an array.")

  const statements = ["PRAGMA foreign_keys=ON;"]
  const totals = { tasks: 0, selections: 0, bidPackages: 0 }
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
    const versionId = `bt-template-version:${template.sourceTemplateId}:1`
    const modules = [
      ["tasks", "tasks"],
      ["selections", "selections"],
      ["bidPackages", "bid_packages"],
    ]
    for (const [sourceKey, moduleType] of modules) {
      const items = template[sourceKey] ?? []
      if (!Array.isArray(items)) {
        throw new Error(`templates[${templateIndex}].${sourceKey} must be an array.`)
      }
      const expected = Number(template.moduleCounts?.[sourceKey] ?? 0)
      if (items.length !== expected) {
        throw new Error(
          `${template.name} ${sourceKey} count mismatch: expected ${expected}, captured ${items.length}.`
        )
      }
      totals[sourceKey] += items.length
      statements.push(
        `DELETE FROM project_template_content_items WHERE version_id=${sql(versionId)} AND module_type=${sql(moduleType)};`
      )
      items.forEach((item, itemIndex) => {
        assertItem(item, `templates[${templateIndex}].${sourceKey}[${itemIndex}]`)
        const cleaned = cleanPayload(item)
        const description = cleanText(
          item.description ?? item.detail?.fullText ?? item.detail?.description ?? null
        )
        statements.push(
          `INSERT INTO project_template_content_items (` +
            `id, version_id, module_type, source_item_id, parent_source_item_id, ` +
            `title, category, description, sort_order, payload_json` +
            `) VALUES (` +
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
              sql(JSON.stringify(cleaned)),
            ].join(", ") +
            `);`
        )
      })
      statements.push(
        `UPDATE project_template_modules SET ` +
          `normalization_status='captured', ` +
          `source_payload_json=${sql(JSON.stringify({ sourceItemCount: items.length, capturedAt: capture.capturedAt }))} ` +
          `WHERE version_id=${sql(versionId)} AND module_type=${sql(moduleType)};`
      )
    }
    statements.push(
      `UPDATE project_templates SET review_status='verified', lifecycle_status='active', ` +
        `source_url=NULL, updated_at=${sql(capture.capturedAt)} ` +
        `WHERE source_system='buildertrend' AND source_template_id=${sql(template.sourceTemplateId)};`
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
