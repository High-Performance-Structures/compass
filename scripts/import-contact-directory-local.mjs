import Database from "better-sqlite3"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { XMLParser } from "fast-xml-parser"

const DB_PATH = "local.db"
const SAGE_VENDOR_XLSX = "/Users/martine/Agents/NetsuiteToSageData/SAGE-VENDORLIST.xlsx"
const BUILDERTREND_VENDOR_CSV =
  "/Users/martine/Documents/GitHub/compass-roadmap/docs/02_Lists/Vendors698.csv"

const INTERNAL_ORGANIZATION_NAMES = new Set([
  "high performance structures",
  "open range construction",
  "nu tech systems",
  "nutech systems",
])

const SKIPPED_INTERNAL_PERSON_NAMES = new Set(["martine vogel", "sylvi vogel"])

const REPORT_PATH = ".codex-snapshots/contact-directory-import-report.json"
const CATEGORY_REVIEW_CSV_PATH = ".codex-snapshots/vendor-category-review.csv"
const REVIEW_DECISIONS_PATH =
  ".codex-snapshots/vendor-category-review-decisions.json"
const EXCLUDED_TAX_AGENCIES_CSV_PATH =
  ".codex-snapshots/excluded-sage-accounting-contacts.csv"

const CANONICAL_VENDOR_CATEGORIES = [
  "Supplier",
  "Subcontractor",
  "Consultant",
  "Governmental Agency",
  "Miscellaneous Vendor",
  "Internal",
  "Building Department",
  "Bank / Lender",
]

const EXCLUDED_ACCOUNTING_CONTACT_NAMES = new Set([
  "buildertrend",
  "buildertrend misc",
  "cpa adj vendor",
  "tax agency",
  "tax agency co",
])

function text(value) {
  return value == null ? "" : String(value).trim()
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

function normalizeName(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(company|co|incorporated|inc|llc|ltd|corp|corporation)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isInternalName(value) {
  const normalized = normalizeName(value)
  return INTERNAL_ORGANIZATION_NAMES.has(normalized)
}

function shouldSkipDirectoryName(value) {
  const name = text(value)
  const normalized = normalizeName(name)
  return (
    !name ||
    /^\d+$/.test(name) ||
    /^-.*-$/.test(name) ||
    SKIPPED_INTERNAL_PERSON_NAMES.has(normalized)
  )
}

function isExcludedSageTaxAgencyName(value) {
  const name = text(value)
  return /^CO_/.test(name)
}

function exclusionReasonForContactName(value) {
  const name = text(value)
  const normalized = normalizeName(name)
  if (isExcludedSageTaxAgencyName(name)) {
    return "Sage tax/remittance agency import beginning with CO_"
  }
  if (/^HomeRule_/i.test(name) || /^Homerule_/i.test(name)) {
    return "Sage tax/remittance agency import beginning with HomeRule_"
  }
  if (EXCLUDED_ACCOUNTING_CONTACT_NAMES.has(normalized)) {
    return "Accounting/system record not needed in Compass contacts"
  }
  return ""
}

function hasAny(value, tokens) {
  return tokens.some((token) => value.includes(token))
}

function hasWord(value, token) {
  return value.split(" ").includes(token)
}

function isGovernmentalAgencyName(name) {
  return (
    name.startsWith("co ") ||
    name.startsWith("home rule ") ||
    name.startsWith("homerule ") ||
    hasAny(name, [
      "city of",
      "town of",
      " county",
      "tax agency",
      "department of revenue",
      "internal revenue",
      "clerk",
      "recorder",
      "public health",
      "board of health",
      "department of labor",
      "regulatory agencies",
      "secretary of state",
      "department of motor vehicles",
      "dmv",
      "treasury",
      "treasurer",
      "family support registry",
      "secure savings",
      "ceridian",
    ]) ||
    hasWord(name, "irs")
  )
}

function isBuildingDepartmentName(name) {
  return (
    hasAny(name, [
      "building department",
      "planning",
      "permitting",
      "permit",
      "community development",
      "inspection",
      "inspections",
      "certificate of occupancy",
    ])
  )
}

function canonicalCategoryForVendor(nameValue, categoryValue) {
  const name = normalizeName(nameValue)
  const category = normalizeName(categoryValue)

  if (isInternalName(nameValue) || category.includes("internal")) return "Internal"
  if (hasAny(category, ["supplier", "material", "equipment"])) return "Supplier"
  if (hasAny(category, ["1099", "subcontract"])) return "Subcontractor"
  if (hasAny(category, ["consultant"])) return "Consultant"
  if (hasAny(category, ["bank", "lender"])) return "Bank / Lender"

  if (isBuildingDepartmentName(name)) {
    return "Building Department"
  }

  if (
    hasAny(name, [
      "bank",
      "credit union",
      "capital finance",
      "premium finance",
      "synchrony",
      "kubota credit",
      "komatsu financial",
      "lender",
      "loan",
      "mortgage",
      "savings",
      "financial",
      "capital",
    ])
  ) {
    return "Bank / Lender"
  }

  if (
    hasAny(name, [
      "architect",
      "architecture",
      "engineering",
      "engineer",
      "survey",
      "surveys",
      "surveying",
      "design",
      "title",
      "association of realtors",
    ])
  ) {
    return "Consultant"
  }

  if (
    hasAny(name, [
      "supply",
      "supplier",
      "materials",
      "material",
      "lumber",
      "redi mix",
      "ready mix",
      "winair",
      "winwater",
      "ferguson",
      "foxworth",
      "galbraith",
      "home depot",
      "lowe",
      "floor decor",
      "appliance",
      "hardware",
      "truss",
      "parts",
      "distributors",
      "distributor",
      "white cap",
      "sherwin",
      "equipment",
      "rental",
      "door",
      "window",
      "windows",
      "stone",
      "granite",
      "steel",
      "precast",
      "sand gravel",
      "concrete sand",
      "fireplace warehouse",
      "lighting",
      "cabinet",
      "cabinets",
      "counter",
      "countertop",
    ])
  ) {
    return "Supplier"
  }

  if (
    hasAny(name, [
      "construction",
      "excavat",
      "concrete",
      "drywall",
      "insulation",
      "plumbing",
      "electric",
      "electrical",
      "painting",
      "tile",
      "roof",
      "septic",
      "pump",
      "heating",
      "hvac",
      "stucco",
      "lath",
      "framing",
      "fence",
      "garage door",
      "glass",
      "masonry",
      "landscap",
      "welding",
      "caulking",
      "radon",
      "flooring",
      "gutter",
      "tree",
      "crane",
      "hauling",
      "trucking",
      "transport",
      "drilling",
      "well service",
      "solar",
      "geothermal",
      "coatings",
      "paving",
      "coring",
      "blasting",
      "waterproofing",
      "sanitation",
      "roll off",
      "porta",
      "restroom",
      "site services",
      "waste",
      "disposal",
      "sewer",
      "drain",
      "mechanical",
      "repairs",
    ])
  ) {
    return "Subcontractor"
  }

  if (isGovernmentalAgencyName(name)) {
    return "Governmental Agency"
  }

  if (
    (hasAny(category, ["tax agency", "tax"]) || hasWord(category, "irs")) &&
    isGovernmentalAgencyName(name)
  ) {
    return "Governmental Agency"
  }

  if (hasAny(category, ["misc", "lender", "501", "delivery", "vendor"])) {
    return "Miscellaneous Vendor"
  }

  return CANONICAL_VENDOR_CATEGORIES.includes(categoryValue) &&
    categoryValue !== "Tax Agency"
    ? categoryValue
    : "Miscellaneous Vendor"
}

function categoryFromBuildertrend(value, name) {
  const category = text(value)
  return canonicalCategoryForVendor(name, category)
}

function chooseDisplayName(row) {
  const printAs = text(row["Print As"])
  if (printAs) return printAs

  const name = text(row.Name)
  const stripped = name.replace(/^\d+\s+/, "").trim()
  return stripped || name
}

function parseCsvLine(line) {
  const cells = []
  let current = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === "," && !quoted) {
      cells.push(current)
      current = ""
    } else {
      current += char
    }
  }

  cells.push(current)
  return cells
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0)
  const headers = parseCsvLine(lines[0]).map(text)
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, text(cells[index])]))
  })
}

function sharedStringText(item) {
  if (!item) return ""
  if (item.t != null) return text(item.t)
  if (Array.isArray(item.r)) {
    return item.r.map((run) => text(run.t)).join("")
  }
  if (item.r) return text(item.r.t)
  return ""
}

function asArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function columnIndex(cellReference) {
  const letters = text(cellReference).replace(/[0-9]/g, "")
  let index = 0
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64
  }
  return index - 1
}

function unzipXml(filePath, entry) {
  return execFileSync("unzip", ["-p", filePath, entry], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
}

function parseSageVendorList(filePath) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  })
  const sharedXml = unzipXml(filePath, "xl/sharedStrings.xml")
  const sheetXml = unzipXml(filePath, "xl/worksheets/sheet1.xml")
  const shared = parser.parse(sharedXml)
  const strings = asArray(shared.sst.si).map(sharedStringText)
  const sheet = parser.parse(sheetXml)
  const rows = asArray(sheet.worksheet.sheetData.row)

  return rows
    .map((row) => {
      const cells = []
      for (const cell of asArray(row.c)) {
        const index = columnIndex(cell["@_r"])
        const rawValue = text(cell.v)
        cells[index] = cell["@_t"] === "s" ? strings[Number(rawValue)] ?? "" : rawValue
      }
      return cells
    })
    .filter((cells) => /^\d+$/.test(text(cells[0])) && text(cells[1]).length > 0)
    .map((cells) => ({
      sageId: text(cells[0]),
      name: text(cells[1]),
      contact: text(cells[2]),
      phone: text(cells[3]),
      fax: text(cells[4]),
    }))
}

function ensureVendorColumns(db) {
  const existing = new Set(
    db.prepare("PRAGMA table_info(vendors)").all().map((column) => column.name)
  )
  const columns = [
    ["source_system", "text DEFAULT 'manual' NOT NULL"],
    ["source_record_id", "text"],
    ["source_record_number", "text"],
    ["source_metadata", "text"],
    ["directory_status", "text DEFAULT 'active' NOT NULL"],
    ["sync_status", "text DEFAULT 'manual' NOT NULL"],
    ["last_synced_at", "text"],
  ]

  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE vendors ADD COLUMN ${name} ${definition}`)
    }
  }
}

function loadOrganizationId(db) {
  const row = db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get()
  if (!row) throw new Error("No organization exists in local.db")
  return row.id
}

function mergeDirectoryRows(sageRows, buildertrendRows) {
  const directory = new Map()
  const skippedInternal = []
  const excludedAccountingContacts = []
  const excludedAccountingContactKeys = new Set()

  for (const row of sageRows) {
    if (shouldSkipDirectoryName(row.name)) {
      skippedInternal.push(row.name)
      continue
    }
    const exclusionReason = exclusionReasonForContactName(row.name)
    if (exclusionReason) {
      excludedAccountingContacts.push({ ...row, reason: exclusionReason })
      excludedAccountingContactKeys.add(normalizeName(row.name))
      continue
    }
    const key = normalizeName(row.name)
    if (!key) continue
    directory.set(key, {
      name: row.name,
      category: canonicalCategoryForVendor(row.name, ""),
      email: "",
      phone: row.phone,
      address: "",
      sourceSystem: "sage",
      sourceRecordId: row.sageId,
      sourceRecordNumber: row.sageId,
      syncStatus: "synced",
      metadata: {
        sage: row,
      },
    })
  }

  for (const row of buildertrendRows) {
    const name = chooseDisplayName(row)
    if (shouldSkipDirectoryName(name)) {
      if (name) skippedInternal.push(name)
      continue
    }
    const key = normalizeName(name)
    if (!key) continue
    if (excludedAccountingContactKeys.has(key)) continue
    if (exclusionReasonForContactName(name)) continue
    const category = categoryFromBuildertrend(row.Category, name)
    const existing = directory.get(key)
    const buildertrend = {
      internalId: text(row["Internal ID"]),
      sourceName: text(row.Name),
      printAs: text(row["Print As"]),
      category: text(row.Category),
      primaryContact: text(row["Primary Contact"]),
    }

    if (existing) {
      directory.set(key, {
        ...existing,
        category:
          existing.category === "Miscellaneous Vendor" ? category : existing.category,
        email: existing.email || text(row.Email),
        phone: existing.phone || text(row.Phone) || text(row["Office Phone"]),
        address: existing.address || text(row["Billing Address"]),
        sourceSystem:
          existing.sourceSystem === "sage" ? "sage_buildertrend" : existing.sourceSystem,
        metadata: {
          ...existing.metadata,
          buildertrend,
        },
      })
    } else {
      directory.set(key, {
        name,
        category,
        email: text(row.Email),
        phone: text(row.Phone) || text(row["Office Phone"]),
        address: text(row["Billing Address"]),
        sourceSystem: "buildertrend",
        sourceRecordId: text(row["Internal ID"]),
        sourceRecordNumber: text(row["Internal ID"]),
        syncStatus: "needs_sage_review",
        metadata: {
          buildertrend,
        },
      })
    }
  }

  return {
    rows: Array.from(directory.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    skippedInternal: Array.from(new Set(skippedInternal)).sort(),
    excludedAccountingContacts,
  }
}

function upsertDirectory(db, organizationId, rows) {
  const now = new Date().toISOString()
  const upsert = db.prepare(`
    INSERT INTO vendors (
      id, name, category, email, phone, address, netsuite_id,
      source_system, source_record_id, source_record_number, source_metadata,
      directory_status, sync_status, last_synced_at, organization_id,
      created_at, updated_at
    )
    VALUES (
      @id, @name, @category, @email, @phone, @address, @netsuiteId,
      @sourceSystem, @sourceRecordId, @sourceRecordNumber, @sourceMetadata,
      'active', @syncStatus, @lastSyncedAt, @organizationId,
      @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = CASE
        WHEN excluded.category = 'Miscellaneous Vendor'
          AND vendors.category IS NOT NULL
          AND vendors.category IN (
            'Supplier',
            'Subcontractor',
            'Consultant',
            'Internal',
            'Governmental Agency',
            'Building Department'
          )
        THEN vendors.category
        ELSE excluded.category
      END,
      email = COALESCE(excluded.email, vendors.email),
      phone = COALESCE(excluded.phone, vendors.phone),
      address = COALESCE(excluded.address, vendors.address),
      source_system = excluded.source_system,
      source_record_id = excluded.source_record_id,
      source_record_number = excluded.source_record_number,
      source_metadata = excluded.source_metadata,
      directory_status = 'active',
      sync_status = excluded.sync_status,
      last_synced_at = excluded.last_synced_at,
      organization_id = excluded.organization_id,
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction((items) => {
    for (const row of items) {
      upsert.run({
        id: `vendor-${slug(row.name)}`,
        name: row.name,
        category: row.category,
        email: row.email || null,
        phone: row.phone || null,
        address: row.address || null,
        netsuiteId: null,
        sourceSystem: row.sourceSystem,
        sourceRecordId: row.sourceRecordId || null,
        sourceRecordNumber: row.sourceRecordNumber || null,
        sourceMetadata: JSON.stringify(row.metadata),
        syncStatus: row.syncStatus,
        lastSyncedAt: row.sourceSystem.includes("sage") ? now : null,
        organizationId,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  tx(rows)
}

function categoryCounts(db) {
  return db
    .prepare(`
      SELECT category, COUNT(*) AS count
      FROM vendors
      WHERE directory_status = 'active'
      GROUP BY category
      ORDER BY count DESC, category
    `)
    .all()
}

function csvCell(value) {
  const content = text(value)
  if (!/[",\n\r]/.test(content)) return content
  return `"${content.replace(/"/g, '""')}"`
}

function writeCategoryReviewCsv(db) {
  const rows = db
    .prepare(`
      SELECT
        source_record_number AS sageId,
        name,
        category,
        source_system AS sourceSystem,
        sync_status AS syncStatus
      FROM vendors
      WHERE directory_status = 'active'
      ORDER BY category, name
    `)
    .all()
  const header = ["sageId", "name", "category", "sourceSystem", "syncStatus"]
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      header.map((key) => csvCell(row[key])).join(",")
    ),
  ]
  fs.writeFileSync(CATEGORY_REVIEW_CSV_PATH, `${lines.join("\n")}\n`)
  return {
    path: CATEGORY_REVIEW_CSV_PATH,
    rows: rows.length,
  }
}

function removeInternalVendorRows(db) {
  const rows = db.prepare("SELECT id, name FROM vendors").all()
  const deleteVendor = db.prepare("DELETE FROM vendors WHERE id = ?")
  for (const row of rows) {
    if (shouldSkipDirectoryName(row.name)) {
      deleteVendor.run(row.id)
    }
  }
}

function writeExcludedAccountingContactsCsv(rows) {
  const header = ["sageId", "name", "reason"]
  const lines = [
    header.join(","),
    ...rows
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((row) =>
        [
          csvCell(row.sageId),
          csvCell(row.name),
          csvCell(row.reason),
        ].join(",")
      ),
  ]
  fs.writeFileSync(EXCLUDED_TAX_AGENCIES_CSV_PATH, `${lines.join("\n")}\n`)
  return {
    path: EXCLUDED_TAX_AGENCIES_CSV_PATH,
    rows: rows.length,
  }
}

function decisionKey(sourceRecordNumber, name) {
  return `${text(sourceRecordNumber)}::${normalizeName(name)}`
}

function loadReviewDecisions() {
  if (!fs.existsSync(REVIEW_DECISIONS_PATH)) {
    return {
      categories: CANONICAL_VENDOR_CATEGORIES,
      rowsByKey: new Map(),
      rowsByName: new Map(),
    }
  }
  const parsed = JSON.parse(fs.readFileSync(REVIEW_DECISIONS_PATH, "utf8"))
  const rows = Array.isArray(parsed.rows) ? parsed.rows : []
  const rowsByKey = new Map()
  const rowsByName = new Map()
  for (const row of rows) {
    const name = text(row.name)
    if (!name) continue
    const key = decisionKey(row.sageId, name)
    rowsByKey.set(key, row)
    rowsByName.set(normalizeName(name), row)
  }
  return {
    categories: Array.isArray(parsed.categories)
      ? parsed.categories.map(text).filter(Boolean)
      : CANONICAL_VENDOR_CATEGORIES,
    rowsByKey,
    rowsByName,
  }
}

function normalizeExistingVendorCategories(db) {
  const rows = db.prepare("SELECT id, name, category FROM vendors").all()
  const update = db.prepare(`
    UPDATE vendors
    SET category = ?, updated_at = ?
    WHERE id = ?
  `)
  const now = new Date().toISOString()
  const changes = []

  const tx = db.transaction((items) => {
    for (const row of items) {
      const nextCategory = canonicalCategoryForVendor(row.name, row.category)
      if (nextCategory !== row.category) {
        update.run(nextCategory, now, row.id)
        changes.push({
          name: row.name,
          from: row.category,
          to: nextCategory,
        })
      }
    }
  })

  tx(rows)
  return changes
}

function reviewDecisionStatus(notesValue) {
  const notes = text(notesValue).toLowerCase()
  if (notes.includes("duplicate")) return "excluded_duplicate"
  if (notes.includes("not really needed") || notes.includes("not needed")) {
    return "excluded_not_needed"
  }
  return ""
}

function applyReviewDecisions(db, reviewDecisions) {
  const rows = db
    .prepare(`
      SELECT
        id,
        name,
        category,
        source_record_number AS sourceRecordNumber,
        source_metadata AS sourceMetadata
      FROM vendors
    `)
    .all()
  const update = db.prepare(`
    UPDATE vendors
    SET
      category = ?,
      directory_status = ?,
      sync_status = CASE
        WHEN ? = 'active' THEN sync_status
        ELSE ?
      END,
      source_metadata = ?,
      updated_at = ?
    WHERE id = ?
  `)
  const now = new Date().toISOString()
  const applied = []
  const excluded = []

  const tx = db.transaction((items) => {
    for (const row of items) {
      if (exclusionReasonForContactName(row.name)) continue
      const decision =
        reviewDecisions.rowsByKey.get(
          decisionKey(row.sourceRecordNumber, row.name)
        ) ?? reviewDecisions.rowsByName.get(normalizeName(row.name))
      if (!decision) continue

      const nextCategory = text(decision.category) || row.category
      const reviewStatus = reviewDecisionStatus(decision.reviewerNotes)
      const directoryStatus = reviewStatus || "active"
      let metadata = {}
      try {
        metadata = row.sourceMetadata ? JSON.parse(row.sourceMetadata) : {}
      } catch {
        metadata = {}
      }
      metadata.review = {
        category: nextCategory,
        reviewerNotes: text(decision.reviewerNotes),
        reviewedAt: now,
      }

      update.run(
        nextCategory,
        directoryStatus,
        directoryStatus,
        directoryStatus,
        JSON.stringify(metadata),
        now,
        row.id
      )

      const item = {
        name: row.name,
        from: row.category,
        to: nextCategory,
        status: directoryStatus,
        notes: text(decision.reviewerNotes),
      }
      applied.push(item)
      if (directoryStatus !== "active") excluded.push(item)
    }
  })

  tx(rows)
  return {
    appliedCount: applied.length,
    excludedCount: excluded.length,
    excludedSample: excluded.slice(0, 50),
    categoryChanges: applied
      .filter((row) => row.from !== row.to)
      .slice(0, 150),
  }
}

function flagExcludedAccountingContactRows(db) {
  const rows = db
    .prepare(`
      SELECT id, name, source_system AS sourceSystem
      FROM vendors
    `)
    .all()
  const update = db.prepare(`
    UPDATE vendors
    SET
      directory_status = 'excluded_accounting_record',
      sync_status = 'excluded_accounting_record',
      updated_at = ?
    WHERE id = ?
  `)
  const now = new Date().toISOString()
  const excluded = rows.filter((row) => exclusionReasonForContactName(row.name))
  const tx = db.transaction((items) => {
    for (const row of items) {
      update.run(now, row.id)
    }
  })
  tx(excluded)
  return excluded
}

function promoteCategoriesFromProjectContacts(db) {
  const rows = db
    .prepare(`
      SELECT source_entity_id AS vendorId, contact_type AS contactType, COUNT(*) AS count
      FROM project_contacts
      WHERE source_entity_type = 'vendor'
        AND source_entity_id IS NOT NULL
        AND contact_type IN ('supplier', 'subcontractor')
      GROUP BY source_entity_id, contact_type
      ORDER BY source_entity_id, count DESC
    `)
    .all()
  const selected = new Map()
  for (const row of rows) {
    if (!selected.has(row.vendorId)) {
      selected.set(row.vendorId, row.contactType)
    }
  }

  const update = db.prepare(`
    UPDATE vendors
    SET category = ?, updated_at = ?
    WHERE id = ?
      AND category = 'Vendor'
  `)
  const now = new Date().toISOString()
  for (const [vendorId, contactType] of selected.entries()) {
    update.run(contactType === "supplier" ? "Supplier" : "Subcontractor", now, vendorId)
  }
}

function main() {
  const db = new Database(DB_PATH)
  const reviewDecisions = loadReviewDecisions()
  ensureVendorColumns(db)
  removeInternalVendorRows(db)
  const beforeCategoryCounts = categoryCounts(db)

  const organizationId = loadOrganizationId(db)
  const sageRows = parseSageVendorList(SAGE_VENDOR_XLSX)
  const buildertrendRows = parseCsv(BUILDERTREND_VENDOR_CSV)
  const merged = mergeDirectoryRows(sageRows, buildertrendRows)
  upsertDirectory(db, organizationId, merged.rows)
  removeInternalVendorRows(db)
  const flaggedExcludedAccountingRows = flagExcludedAccountingContactRows(db)
  promoteCategoriesFromProjectContacts(db)
  const categoryChanges = normalizeExistingVendorCategories(db)
  const reviewDecisionResults = applyReviewDecisions(db, reviewDecisions)
  const afterCategoryCounts = categoryCounts(db)
  const categoryReviewCsv = writeCategoryReviewCsv(db)
  const excludedAccountingContactsCsv = writeExcludedAccountingContactsCsv(
    merged.excludedAccountingContacts
  )

  const summary = {
    importedAt: new Date().toISOString(),
    sources: {
      sageVendorList: SAGE_VENDOR_XLSX,
      buildertrendVendorList: BUILDERTREND_VENDOR_CSV,
    },
    sageRows: sageRows.length,
    buildertrendRows: buildertrendRows.length,
    directoryRows: merged.rows.length,
    sageBackedRows: merged.rows.filter((row) => row.sourceSystem.includes("sage"))
      .length,
    buildertrendOnlyRows: merged.rows.filter((row) => row.sourceSystem === "buildertrend")
      .length,
    canonicalCategories: reviewDecisions.categories,
    categoryCounts: {
      before: beforeCategoryCounts,
      after: afterCategoryCounts,
    },
    categoryChanges: {
      count: categoryChanges.length + reviewDecisionResults.categoryChanges.length,
      heuristicSample: categoryChanges.slice(0, 150),
      reviewedSample: reviewDecisionResults.categoryChanges,
    },
    reviewDecisions: reviewDecisionResults,
    categoryReviewCsv,
    excludedAccountingContactsCsv,
    excludedAccountingContacts: {
      count: merged.excludedAccountingContacts.length,
      flaggedExistingRows: flaggedExcludedAccountingRows.length,
      sample: merged.excludedAccountingContacts.slice(0, 50),
    },
    skippedInternal: merged.skippedInternal,
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

main()
