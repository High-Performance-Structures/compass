import { createHash } from "node:crypto"

const MODULES = [
  ["tasks", "tasks"],
  ["scheduleItems", "schedule"],
  ["selections", "selections"],
  ["bidPackages", "bid_packages"],
]

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value.trim()
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

function contentId(templateId, moduleType, sourceItemId) {
  const digest = createHash("sha256")
    .update(`${templateId}:${moduleType}:${sourceItemId}`)
    .digest("hex")
    .slice(0, 24)
  return `bt-template-content:${digest}`
}

function jsonRows(rows, columnCount) {
  const columns = Array.from(
    { length: columnCount },
    (_, index) => `json_extract(value, '$[${index}]')`
  ).join(", ")
  return `SELECT ${columns} FROM json_each(${sql(JSON.stringify(rows))})`
}

function assertCoverage(capture, inventory) {
  if (
    !isRecord(capture) ||
    capture.assembly?.complete !== true ||
    capture.assembly?.draftOnly !== true ||
    capture.assembly?.publish !== false ||
    !Array.isArray(capture.templates)
  ) {
    throw new Error("Verification requires a complete, draft-only assembled capture.")
  }
  if (!isRecord(inventory) || !Array.isArray(inventory.templates)) {
    throw new Error("Verification inventory must contain templates.")
  }
  if (
    inventory.expectedActiveCount !== inventory.templates.length ||
    capture.templates.length !== inventory.templates.length ||
    capture.excludedArchivedCount !== inventory.excludedArchivedCount
  ) {
    throw new Error("Verification capture and inventory coverage do not match.")
  }
  const inventoryById = new Map(inventory.templates.map((template) => [template.sourceTemplateId, template]))
  for (const [index, template] of capture.templates.entries()) {
    const id = requiredString(template?.sourceTemplateId, `capture.templates[${index}].sourceTemplateId`)
    const name = requiredString(template?.name, `capture.templates[${index}].name`)
    const expected = inventoryById.get(id)
    if (!expected || expected.name !== name) throw new Error(`Verification identity mismatch for ${id}.`)
  }
  if (new Set(capture.templates.map((template) => template.sourceTemplateId)).size !== capture.templates.length) {
    throw new Error("Verification capture contains duplicate template IDs.")
  }
}

function conversionExceptionModules(capture) {
  const keys = new Set()
  for (const exception of capture.conversionExceptions ?? []) {
    if (!isRecord(exception)) throw new Error("Verification conversion exceptions must be objects.")
    keys.add(`${exception.templateSourceTemplateId}:${exception.module}`)
  }
  return keys
}

function expectedRows(capture, inventory) {
  const inventoryById = new Map(inventory.templates.map((template) => [template.sourceTemplateId, template]))
  const warningModules = conversionExceptionModules(capture)
  const templates = []
  const modules = []
  const items = []
  const predecessors = []
  const reusableScheduleItems = []
  const reusableScheduleDependencies = []
  for (const [templateIndex, template] of capture.templates.entries()) {
    const sourceTemplateId = template.sourceTemplateId
    const inventoryTemplate = inventoryById.get(sourceTemplateId)
    const versionId = `bt-template-version:${sourceTemplateId}:1`
    let contentCount = 0
    let predecessorCount = 0
    for (const [sourceKey, moduleType] of MODULES) {
      const moduleItems = template[sourceKey] ?? []
      if (!Array.isArray(moduleItems)) {
        throw new Error(`capture.templates[${templateIndex}].${sourceKey} must be an array.`)
      }
      const expectedCount = inventoryTemplate.moduleCounts?.[sourceKey] ?? 0
      if (moduleItems.length !== expectedCount) {
        throw new Error(
          `${template.name} ${sourceKey} count mismatch: expected ${expectedCount}, found ${moduleItems.length}.`
        )
      }
      contentCount += moduleItems.length
      modules.push([
        sourceTemplateId,
        versionId,
        moduleType,
        expectedCount,
        warningModules.has(`${sourceTemplateId}:${sourceKey}`)
          ? "captured_with_warnings"
          : "captured",
      ])
      const sourceIds = new Set()
      const modulePredecessors = []
      moduleItems.forEach((item, itemIndex) => {
        const sourceItemId = requiredString(
          item?.sourceItemId,
          `capture.templates[${templateIndex}].${sourceKey}[${itemIndex}].sourceItemId`
        )
        if (sourceIds.has(sourceItemId)) {
          throw new Error(`${template.name} ${sourceKey} duplicates sourceItemId ${sourceItemId}.`)
        }
        sourceIds.add(sourceItemId)
        const title = requiredString(
          item?.title,
          `capture.templates[${templateIndex}].${sourceKey}[${itemIndex}].title`
        )
        if (sourceKey === "scheduleItems") {
          if (!Array.isArray(item.predecessors)) {
            throw new Error(`${template.name} schedule item ${sourceItemId} must contain predecessors.`)
          }
          predecessorCount += item.predecessors.length
          item.predecessors.forEach((predecessor, predecessorIndex) => {
            const predecessorPath =
              `capture.templates[${templateIndex}].${sourceKey}[${itemIndex}].predecessors[${predecessorIndex}]`
            const predecessorSourceItemId = requiredString(
              predecessor?.predecessorSourceItemId,
              `${predecessorPath}.predecessorSourceItemId`
            )
            const successorSourceItemId = requiredString(
              predecessor?.successorSourceItemId,
              `${predecessorPath}.successorSourceItemId`
            )
            const relationshipType = requiredString(predecessor?.type, `${predecessorPath}.type`)
            if (!["FS", "SS", "FF", "SF"].includes(relationshipType)) {
              throw new Error(`${predecessorPath}.type must be FS, SS, FF, or SF.`)
            }
            if (!Number.isInteger(predecessor?.lagDays)) {
              throw new Error(`${predecessorPath}.lagDays must be an integer.`)
            }
            if (successorSourceItemId !== sourceItemId) {
              throw new Error(`${predecessorPath}.successorSourceItemId must match its schedule item.`)
            }
            const row = [
              sourceTemplateId,
              versionId,
              sourceItemId,
              predecessorSourceItemId,
              successorSourceItemId,
              relationshipType,
              predecessor.lagDays,
            ]
            predecessors.push(row)
            modulePredecessors.push(row)
            reusableScheduleDependencies.push([
              sourceTemplateId,
              versionId,
              `bt-template-dependency:${sourceTemplateId}:${predecessorSourceItemId}:${successorSourceItemId}:${relationshipType}`,
              `bt-template-item:${sourceTemplateId}:${predecessorSourceItemId}`,
              `bt-template-item:${sourceTemplateId}:${successorSourceItemId}`,
              relationshipType,
              predecessor.lagDays,
            ])
          })
          reusableScheduleItems.push([
            sourceTemplateId,
            versionId,
            sourceItemId,
            `bt-template-item:${sourceTemplateId}:${sourceItemId}`,
            `buildertrend:${sourceItemId}`,
            cleanText(title),
          ])
        }
        items.push([
          sourceTemplateId,
          versionId,
          moduleType,
          sourceItemId,
          contentId(sourceTemplateId, moduleType, sourceItemId),
          item.parentSourceItemId ?? null,
          cleanText(title),
          Number.isInteger(item.sortOrder) ? item.sortOrder : itemIndex,
        ])
      })
      if (sourceKey === "scheduleItems") {
        const edgeKeys = new Set()
        for (const predecessor of modulePredecessors) {
          if (!sourceIds.has(predecessor[3]) || !sourceIds.has(predecessor[4])) {
            throw new Error(`${template.name} has a predecessor outside its captured schedule items.`)
          }
          const edgeKey = predecessor.slice(3, 6).join(":")
          if (edgeKeys.has(edgeKey)) {
            throw new Error(`${template.name} duplicates schedule predecessor ${edgeKey}.`)
          }
          edgeKeys.add(edgeKey)
        }
      }
    }
    templates.push([
      sourceTemplateId,
      template.name,
      versionId,
      contentCount,
      template.scheduleItems?.length ?? 0,
      predecessorCount,
    ])
  }
  return {
    templates,
    modules,
    items,
    predecessors,
    reusableScheduleItems,
    reusableScheduleDependencies,
  }
}

function stripSqlStrings(sqlText) {
  let stripped = ""
  let inString = false
  for (let index = 0; index < sqlText.length; index += 1) {
    const character = sqlText[index]
    if (character !== "'") {
      if (!inString) stripped += character
      continue
    }
    if (inString && sqlText[index + 1] === "'") {
      index += 1
      continue
    }
    inString = !inString
  }
  if (inString) throw new Error("Verification SQL contains an unterminated string.")
  return stripped
}

export function assertReadOnlyVerificationSql(sqlText) {
  const stripped = stripSqlStrings(sqlText).trim()
  if (!/^WITH\b/i.test(stripped)) throw new Error("Verification SQL must begin with a read-only CTE.")
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(stripped)) {
    throw new Error("Verification SQL contains a mutation or database-control statement.")
  }
  const statements = stripped.split(";").filter((part) => part.trim())
  if (statements.length !== 1 || !/;\s*$/.test(stripped)) {
    throw new Error("Verification SQL must contain exactly one statement.")
  }
  return true
}

export function buildBuildertrendTemplateContentVerificationSql({
  capture,
  inventory,
  organizationId,
  phase,
  excludedSourceTemplateIds = [],
}) {
  assertCoverage(capture, inventory)
  const orgId = requiredString(organizationId, "organizationId")
  if (phase !== "preflight" && phase !== "postflight") {
    throw new Error("Verification phase must be preflight or postflight.")
  }
  const expected = expectedRows(capture, inventory)
  const excluded = [...new Set(excludedSourceTemplateIds)].map((sourceTemplateId, index) => {
    const id = requiredString(sourceTemplateId, `excludedSourceTemplateIds[${index}]`)
    if (capture.templates.some((template) => template.sourceTemplateId === id)) {
      throw new Error(`Excluded template ${id} is also present in the capture.`)
    }
    return [id, `bt-template-version:${id}:1`]
  })
  const expectedTemplateIds = capture.templates.map((template) => template.sourceTemplateId)
  const allowedTemplateState = phase === "preflight"
    ? "((t.lifecycle_status='draft' AND t.review_status IN ('inventory_only', 'content_captured')) OR " +
      "(t.lifecycle_status='active' AND t.review_status='verified'))"
    : "((t.lifecycle_status='draft' AND t.review_status='content_captured') OR " +
      "(t.lifecycle_status='active' AND t.review_status='verified'))"
  const contentCountRule = phase === "preflight"
    ? "actual_count <> content_count AND NOT (actual_count=0 AND EXISTS (" +
      "SELECT 1 FROM project_template_versions v WHERE v.id=content_totals.version_id AND v.status='draft'))"
    : "actual_count <> content_count"
  const contentModuleRule = phase === "preflight"
    ? "actual_count <> expected_count AND NOT (actual_count=0 AND EXISTS (" +
      "SELECT 1 FROM project_template_versions v WHERE v.id=module_totals.version_id AND v.status='draft'))"
    : "actual_count <> expected_count"
  const itemCheckGuard = phase === "preflight"
    ? "AND (SELECT COUNT(*) FROM project_template_content_items c WHERE c.version_id=e.version_id) > 0"
    : ""
  const sqlText = `WITH
  expected_templates(source_template_id, name, version_id, content_count, schedule_count, predecessor_count) AS (
    ${jsonRows(expected.templates, 6)}
  ),
  expected_modules(source_template_id, version_id, module_type, expected_count, expected_status) AS (
    ${jsonRows(expected.modules, 5)}
  ),
  expected_items(source_template_id, version_id, module_type, source_item_id, content_id, parent_source_item_id, title, sort_order) AS (
    ${jsonRows(expected.items, 8)}
  ),
  expected_predecessors(source_template_id, version_id, successor_item_id, predecessor_item_id, recorded_successor_item_id, relationship_type, lag_days) AS (
    ${jsonRows(expected.predecessors, 7)}
  ),
  expected_reusable_schedule_items(source_template_id, version_id, source_item_id, item_id, item_key, title) AS (
    ${jsonRows(expected.reusableScheduleItems, 6)}
  ),
  expected_reusable_schedule_dependencies(source_template_id, version_id, dependency_id, predecessor_item_id, successor_item_id, relationship_type, lag_days) AS (
    ${jsonRows(expected.reusableScheduleDependencies, 7)}
  ),
  excluded_templates(source_template_id, version_id) AS (
    ${jsonRows(excluded, 2)}
  ),
  content_totals AS (
    SELECT e.source_template_id, e.version_id, e.content_count,
      (SELECT COUNT(*) FROM project_template_content_items c WHERE c.version_id=e.version_id) AS actual_count
    FROM expected_templates e
  ),
  module_totals AS (
    SELECT e.source_template_id, e.version_id, e.module_type, e.expected_count, e.expected_status,
      (SELECT COUNT(*) FROM project_template_content_items c
       WHERE c.version_id=e.version_id AND c.module_type=e.module_type) AS actual_count
    FROM expected_modules e
  ),
  issues(check_name, source_template_id, expected, actual) AS (
    SELECT 'template_identity', e.source_template_id, '1', CAST((
      SELECT COUNT(*) FROM project_templates t
      WHERE t.organization_id=${sql(orgId)} AND t.source_system='buildertrend'
        AND t.source_template_id=e.source_template_id
    ) AS TEXT)
    FROM expected_templates e
    WHERE (SELECT COUNT(*) FROM project_templates t
      WHERE t.organization_id=${sql(orgId)} AND t.source_system='buildertrend'
        AND t.source_template_id=e.source_template_id) <> 1
      OR NOT EXISTS (SELECT 1 FROM project_templates t
        WHERE t.organization_id=${sql(orgId)} AND t.source_system='buildertrend'
          AND t.source_template_id=e.source_template_id AND t.name=e.name)
    UNION ALL
    SELECT 'template_draft_state', e.source_template_id,
      ${sql(phase === "preflight"
        ? "draft/inventory-or-content-captured or active/verified / version 1 / no source URL"
        : "draft/content-captured or active/verified / version 1 / no source URL")},
      COALESCE((SELECT t.lifecycle_status || ' / ' || t.review_status || ' / version ' ||
        COALESCE(CAST(t.current_version_number AS TEXT), 'NULL') || ' / ' || COALESCE(t.source_url, 'NULL')
        FROM project_templates t WHERE t.organization_id=${sql(orgId)}
          AND t.source_system='buildertrend' AND t.source_template_id=e.source_template_id LIMIT 1), 'missing')
    FROM expected_templates e
    WHERE NOT EXISTS (SELECT 1 FROM project_templates t
      WHERE t.organization_id=${sql(orgId)} AND t.source_system='buildertrend'
        AND t.source_template_id=e.source_template_id
        AND ${allowedTemplateState} AND t.current_version_number=1 AND t.source_url IS NULL)
    UNION ALL
    SELECT 'version_state', e.source_template_id, 'one matching draft or published version linked to target template', CAST((
      SELECT COUNT(*) FROM project_template_versions v
      JOIN project_templates t ON t.id=v.template_id
      WHERE v.id=e.version_id AND v.version_number=1 AND t.organization_id=${sql(orgId)}
        AND t.source_system='buildertrend' AND t.source_template_id=e.source_template_id
        AND ((v.status='draft' AND t.lifecycle_status='draft') OR
          (v.status='published' AND t.lifecycle_status='active' AND t.review_status='verified'))
    ) AS TEXT)
    FROM expected_templates e
    WHERE (SELECT COUNT(*) FROM project_template_versions v
      JOIN project_templates t ON t.id=v.template_id
      WHERE v.id=e.version_id AND v.version_number=1 AND t.organization_id=${sql(orgId)}
        AND t.source_system='buildertrend' AND t.source_template_id=e.source_template_id
        AND ((v.status='draft' AND t.lifecycle_status='draft') OR
          (v.status='published' AND t.lifecycle_status='active' AND t.review_status='verified'))) <> 1
    UNION ALL
    SELECT 'module_source_count', e.source_template_id,
      e.module_type || ':' || CAST(e.expected_count AS TEXT),
      COALESCE((SELECT m.module_type || ':' || CAST(m.source_item_count AS TEXT)
        FROM project_template_modules m WHERE m.version_id=e.version_id
          AND m.module_type=e.module_type LIMIT 1), 'missing')
    FROM expected_modules e
    WHERE (SELECT COUNT(*) FROM project_template_modules m WHERE m.version_id=e.version_id
      AND m.module_type=e.module_type AND m.source_item_count=e.expected_count) <> 1
    UNION ALL
    SELECT 'module_normalization', e.source_template_id,
      ${phase === "preflight" ? "'inventory_only-or-captured'" : "e.expected_status"},
      COALESCE((SELECT m.normalization_status FROM project_template_modules m
        WHERE m.version_id=e.version_id AND m.module_type=e.module_type LIMIT 1), 'missing')
    FROM expected_modules e
    WHERE NOT EXISTS (SELECT 1 FROM project_template_modules m WHERE m.version_id=e.version_id
      AND m.module_type=e.module_type AND ${phase === "preflight"
        ? "((m.normalization_status IN ('inventory_only', 'captured', 'captured_with_warnings') AND EXISTS (" +
          "SELECT 1 FROM project_template_versions v WHERE v.id=e.version_id AND v.status='draft')) OR " +
          "(m.normalization_status=e.expected_status AND EXISTS (" +
          "SELECT 1 FROM project_template_versions v WHERE v.id=e.version_id AND v.status='published')))"
        : "m.normalization_status=e.expected_status"})
    UNION ALL
    SELECT 'content_total', source_template_id, CAST(content_count AS TEXT), CAST(actual_count AS TEXT)
    FROM content_totals WHERE ${contentCountRule}
    UNION ALL
    SELECT 'content_module_total', source_template_id,
      module_type || ':' || CAST(expected_count AS TEXT),
      module_type || ':' || CAST(actual_count AS TEXT)
    FROM module_totals WHERE ${contentModuleRule}
    UNION ALL
    SELECT 'expected_item_identity', e.source_template_id, '0 mismatches', CAST(COUNT(*) AS TEXT)
    FROM expected_items e
    LEFT JOIN project_template_content_items c ON c.id=e.content_id AND c.version_id=e.version_id
      AND c.module_type=e.module_type AND c.source_item_id=e.source_item_id
      AND c.parent_source_item_id IS e.parent_source_item_id
      AND c.title=e.title AND c.sort_order=e.sort_order
    WHERE e.source_template_id IS NOT NULL AND c.id IS NULL ${itemCheckGuard}
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'unexpected_content_item', e.source_template_id, '0', CAST(COUNT(*) AS TEXT)
    FROM expected_templates e
    JOIN project_template_content_items c ON c.version_id=e.version_id
    WHERE NOT EXISTS (SELECT 1 FROM expected_items x WHERE x.content_id=c.id
      AND x.version_id=c.version_id AND x.module_type=c.module_type
      AND x.source_item_id=c.source_item_id)
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'payload_integrity', e.source_template_id, 'valid JSON without Buildertrend URLs', CAST(COUNT(*) AS TEXT)
    FROM expected_templates e
    JOIN project_template_content_items c ON c.version_id=e.version_id
    WHERE c.payload_json IS NULL OR json_valid(c.payload_json) <> 1
      OR lower(c.payload_json) LIKE '%buildertrend.net%'
      OR lower(COALESCE(c.description, '')) LIKE '%buildertrend.net%'
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'schedule_predecessors', e.source_template_id, CAST(e.predecessor_count AS TEXT), CAST(COALESCE((
      SELECT SUM(COALESCE(json_array_length(json_extract(c.payload_json, '$.predecessors')), 0))
      FROM project_template_content_items c WHERE c.version_id=e.version_id AND c.module_type='schedule'
    ), 0) AS TEXT)
    FROM expected_templates e
    WHERE ${phase === "preflight" ? "(SELECT COUNT(*) FROM project_template_content_items c WHERE c.version_id=e.version_id) > 0 AND " : ""}
      COALESCE((SELECT SUM(COALESCE(json_array_length(json_extract(c.payload_json, '$.predecessors')), 0))
        FROM project_template_content_items c WHERE c.version_id=e.version_id AND c.module_type='schedule'), 0)
      <> e.predecessor_count
    UNION ALL
    SELECT 'expected_predecessor_identity', e.source_template_id, '0 mismatches', CAST(COUNT(*) AS TEXT)
    FROM expected_predecessors e
    LEFT JOIN project_template_content_items c ON c.version_id=e.version_id
      AND c.module_type='schedule' AND c.source_item_id=e.successor_item_id
    LEFT JOIN json_each(
      CASE WHEN json_valid(c.payload_json) THEN c.payload_json ELSE '{"predecessors":[]}' END,
      '$.predecessors'
    ) predecessor ON json_extract(predecessor.value, '$.predecessorSourceItemId')=e.predecessor_item_id
      AND json_extract(predecessor.value, '$.successorSourceItemId')=e.recorded_successor_item_id
      AND json_extract(predecessor.value, '$.type')=e.relationship_type
      AND json_extract(predecessor.value, '$.lagDays')=e.lag_days
    WHERE e.source_template_id IS NOT NULL AND predecessor.key IS NULL ${itemCheckGuard}
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'unexpected_predecessor', t.source_template_id, '0', CAST(COUNT(*) AS TEXT)
    FROM expected_templates t
    JOIN project_template_content_items c ON c.version_id=t.version_id AND c.module_type='schedule'
    JOIN json_each(
      CASE WHEN json_valid(c.payload_json) THEN c.payload_json ELSE '{"predecessors":[]}' END,
      '$.predecessors'
    ) predecessor
    WHERE NOT EXISTS (SELECT 1 FROM expected_predecessors e
      WHERE e.version_id=c.version_id AND e.successor_item_id=c.source_item_id
        AND e.predecessor_item_id=json_extract(predecessor.value, '$.predecessorSourceItemId')
        AND e.recorded_successor_item_id=json_extract(predecessor.value, '$.successorSourceItemId')
        AND e.relationship_type=json_extract(predecessor.value, '$.type')
        AND e.lag_days=json_extract(predecessor.value, '$.lagDays'))
    GROUP BY t.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'reusable_schedule_total', e.source_template_id,
      CAST(e.schedule_count AS TEXT), CAST((
        SELECT COUNT(*) FROM schedule_template_items s WHERE s.version_id=e.version_id
      ) AS TEXT)
    FROM expected_templates e
    WHERE ${phase === "preflight"
      ? `(SELECT COUNT(*) FROM schedule_template_items s WHERE s.version_id=e.version_id) <> e.schedule_count AND NOT (` +
        `(SELECT COUNT(*) FROM schedule_template_items s WHERE s.version_id=e.version_id)=0 AND EXISTS (` +
        `SELECT 1 FROM project_template_versions v WHERE v.id=e.version_id AND v.status='draft'))`
      : `(SELECT COUNT(*) FROM schedule_template_items s WHERE s.version_id=e.version_id) <> e.schedule_count`}
    UNION ALL
    SELECT 'reusable_schedule_identity', e.source_template_id, '0 mismatches', CAST(COUNT(*) AS TEXT)
    FROM expected_reusable_schedule_items e
    LEFT JOIN schedule_template_items s ON s.id=e.item_id AND s.version_id=e.version_id
      AND s.source_item_id=e.source_item_id AND s.item_key=e.item_key AND s.title=e.title
    WHERE e.source_template_id IS NOT NULL AND s.id IS NULL
      ${phase === "preflight" ? "AND (SELECT COUNT(*) FROM schedule_template_items x WHERE x.version_id=e.version_id) > 0" : ""}
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'unexpected_reusable_schedule_item', e.source_template_id, '0', CAST(COUNT(*) AS TEXT)
    FROM expected_templates e
    JOIN schedule_template_items s ON s.version_id=e.version_id
    WHERE NOT EXISTS (SELECT 1 FROM expected_reusable_schedule_items x
      WHERE x.item_id=s.id AND x.version_id=s.version_id)
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'reusable_dependency_total', e.source_template_id,
      CAST(e.predecessor_count AS TEXT), CAST((
        SELECT COUNT(*) FROM schedule_template_dependencies d WHERE d.version_id=e.version_id
      ) AS TEXT)
    FROM expected_templates e
    WHERE ${phase === "preflight"
      ? `(SELECT COUNT(*) FROM schedule_template_dependencies d WHERE d.version_id=e.version_id) <> e.predecessor_count AND NOT (` +
        `(SELECT COUNT(*) FROM schedule_template_dependencies d WHERE d.version_id=e.version_id)=0 AND EXISTS (` +
        `SELECT 1 FROM project_template_versions v WHERE v.id=e.version_id AND v.status='draft'))`
      : `(SELECT COUNT(*) FROM schedule_template_dependencies d WHERE d.version_id=e.version_id) <> e.predecessor_count`}
    UNION ALL
    SELECT 'reusable_dependency_identity', e.source_template_id, '0 mismatches', CAST(COUNT(*) AS TEXT)
    FROM expected_reusable_schedule_dependencies e
    LEFT JOIN schedule_template_dependencies d ON d.id=e.dependency_id AND d.version_id=e.version_id
      AND d.predecessor_item_id=e.predecessor_item_id AND d.successor_item_id=e.successor_item_id
      AND d.type=e.relationship_type AND d.lag_days=e.lag_days
    WHERE e.source_template_id IS NOT NULL AND d.id IS NULL
      ${phase === "preflight" ? "AND (SELECT COUNT(*) FROM schedule_template_dependencies x WHERE x.version_id=e.version_id) > 0" : ""}
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'unexpected_reusable_dependency', e.source_template_id, '0', CAST(COUNT(*) AS TEXT)
    FROM expected_templates e
    JOIN schedule_template_dependencies d ON d.version_id=e.version_id
    WHERE NOT EXISTS (SELECT 1 FROM expected_reusable_schedule_dependencies x
      WHERE x.dependency_id=d.id AND x.version_id=d.version_id)
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'template_applications', e.source_template_id, '0', CAST(COUNT(*) AS TEXT)
    FROM expected_templates e
    JOIN project_template_applications a ON a.version_id=e.version_id
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
    UNION ALL
    SELECT 'excluded_template_content', e.source_template_id, '0', CAST(COUNT(*) AS TEXT)
    FROM excluded_templates e
    JOIN project_template_content_items c ON c.version_id=e.version_id
    WHERE e.source_template_id IS NOT NULL
    GROUP BY e.source_template_id HAVING COUNT(*) > 0
  )
SELECT ${sql(phase)} AS phase, check_name, source_template_id, expected, actual
FROM issues
ORDER BY source_template_id, check_name;
`
  assertReadOnlyVerificationSql(sqlText)
  return {
    sql: sqlText,
    phase,
    organizationId: orgId,
    templateCount: expected.templates.length,
    contentItemCount: expected.items.length,
    predecessorCount: expected.predecessors.length,
    reusableScheduleItemCount: expected.reusableScheduleItems.length,
    reusableDependencyCount: expected.reusableScheduleDependencies.length,
    sourceTemplateIds: expectedTemplateIds,
    excludedSourceTemplateIds: excluded.map((row) => row[0]),
  }
}
