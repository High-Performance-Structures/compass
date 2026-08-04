import { RFQ_VENDOR_CATEGORY_OPTIONS } from "@/lib/project-rfq-categories"

type JsonObject = Readonly<Record<string, unknown>>

export type NormalizedTemplateRfqScopeItem = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly notes: string | null
}

export type NormalizedTemplateRfqDocumentLink = {
  readonly lineNumber: number
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type TemplateRfqReview = {
  readonly unresolvedPlaceholders: readonly string[]
  readonly requiresDocumentPackage: boolean
}

export type NormalizedTemplateBidPackage = {
  readonly overallScope: string | null
  readonly vendorCategory: string | null
  readonly scopeItems: readonly NormalizedTemplateRfqScopeItem[]
  readonly documentLinks: readonly NormalizedTemplateRfqDocumentLink[]
  readonly primaryCostCode: string | null
  readonly templateReview: TemplateRfqReview | null
}

const SECTION_HEADINGS = new Map(
  [
    "Background",
    "Reference Documents",
    "Submission of Bid",
    "Timeline",
    "Scope of Work",
    "Questions",
    "Schedule",
    "Contract and Insurance Requirements",
  ].map((heading) => [heading.toLowerCase(), heading])
)

const PLACEHOLDER_KEYWORDS = [
  "address",
  "build",
  "city",
  "email",
  "estimate",
  "estimator",
  "extension",
  "name",
  "phase",
  "project",
  "season",
  "state",
  "street",
  "title",
  "type",
  "year",
  "zip",
] as const

function jsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return Object.fromEntries(Object.entries(value))
}

function parsePayloadJson(value: string | null): JsonObject {
  if (!value) return {}
  try {
    const parsed = jsonObject(JSON.parse(value))
    if (!parsed) throw new Error("Template bid package payload must be an object.")
    return parsed
  } catch {
    throw new Error("Template bid package has an invalid captured payload.")
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function objectArray(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const object = jsonObject(item)
    return object ? [object] : []
  })
}

function costCode(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/^([0-9]{2}(?:\s+[0-9]{2}){1,2})\b/)
  return match?.[1] ?? null
}

function sectionLines(
  payload: JsonObject,
  description: string | null
): readonly string[] {
  if (Array.isArray(payload.descriptionSections)) {
    const lines = payload.descriptionSections.flatMap((value) => {
      const line = text(value)
      return line ? [line] : []
    })
    if (lines.length > 0) return lines
  }
  return description?.split("\n").map((line) => line.trim()).filter(Boolean) ?? []
}

function normalizedSectionBody(
  heading: string,
  body: readonly string[]
): readonly string[] {
  if (heading === "Reference Documents") {
    return [
      "Use the Plans & specs package on this RFQ for the applicable plans, specifications, and addenda.",
    ]
  }
  if (heading === "Submission of Bid") {
    return [
      "Submit the bid through this Compass RFQ or send it to the project contact listed on the RFQ for entry. Include a PDF proposal and clearly identify exclusions, clarifications, and the requested schedule.",
    ]
  }
  if (heading === "Questions") {
    return [
      "Submit questions through the project RFI process in Compass so responses remain organized and available to the project team.",
    ]
  }
  return body
}

function formatNarrative(
  payload: JsonObject,
  description: string | null
): string | null {
  const lines = sectionLines(payload, description)
  if (lines.length === 0) return null

  const sections: { heading: string; body: string[] }[] = []
  for (const line of lines) {
    const heading = SECTION_HEADINGS.get(line.toLowerCase())
    if (heading) {
      const current = sections[sections.length - 1]
      if (current?.heading === heading && current.body.length === 0) {
        current.body.push(line)
        continue
      }
      sections.push({ heading, body: [] })
      continue
    }
    const current = sections[sections.length - 1]
    if (current) {
      current.body.push(line)
    } else {
      sections.push({ heading: "Overview", body: [line] })
    }
  }

  return sections
    .map(({ heading, body }) => {
      const normalizedBody = normalizedSectionBody(heading, body)
      return [heading.toUpperCase(), ...normalizedBody].join("\n")
    })
    .join("\n\n")
}

function scopeItemNotes(line: JsonObject): string | null {
  const costType = text(line.costType)
  const quantity = number(line.quantity)
  const unit = text(line.unit)
  const parts = [
    costType && costType.toLowerCase() !== "none"
      ? `Cost type: ${costType}`
      : null,
    quantity !== null
      ? `Template quantity: ${quantity}${unit ? ` ${unit}` : ""}`
      : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(" | ") : null
}

function normalizeScopeItems(
  payload: JsonObject
): readonly NormalizedTemplateRfqScopeItem[] {
  return objectArray(payload.lineItems).flatMap((line, index) => {
    const description = text(line.title) ?? text(line.description)
    if (!description) return []
    return [
      {
        lineNumber: index + 1,
        description,
        phaseCode: null,
        costCode: costCode(text(line.costCode)),
        notes: scopeItemNotes(line),
      },
    ]
  })
}

function normalizeDocumentLinks(
  payload: JsonObject
): readonly NormalizedTemplateRfqDocumentLink[] {
  return objectArray(payload.attachments).flatMap((attachment, index) => {
    const url = text(attachment.url)
    if (!url) return []
    return [
      {
        lineNumber: index + 1,
        label:
          text(attachment.fileName) ??
          text(attachment.title) ??
          `Template document ${index + 1}`,
        url,
        notes: text(attachment.notes),
      },
    ]
  })
}

function inferVendorCategory(
  title: string,
  scopeItems: readonly NormalizedTemplateRfqScopeItem[]
): string | null {
  const normalizedTitle = title.toLowerCase()
  const keywordMatch = [
    { keyword: "drywall", label: "Drywall / Gypsum" },
    { keyword: "roof", label: "Roofing" },
    { keyword: "cabinet", label: "Cabinets / Countertops" },
    { keyword: "countertop", label: "Cabinets / Countertops" },
  ].find(({ keyword }) => normalizedTitle.includes(keyword))
  if (keywordMatch) return keywordMatch.label

  const division = scopeItems[0]?.costCode?.slice(0, 2) ?? null
  if (!division) return null
  const matches = RFQ_VENDOR_CATEGORY_OPTIONS.filter(
    (option) => option.division === division
  )
  return matches.length === 1 ? matches[0]?.label ?? null : null
}

export function findTemplatePlaceholders(
  values: readonly (string | null)[]
): readonly string[] {
  const placeholders = new Set<string>()
  for (const value of values) {
    if (!value) continue
    for (const match of value.matchAll(/\(([^()\n]{2,80})\)/g)) {
      const token = match[0]
      const content = match[1]?.toLowerCase() ?? ""
      if (PLACEHOLDER_KEYWORDS.some((keyword) => content.includes(keyword))) {
        placeholders.add(token)
      }
    }
  }
  return [...placeholders]
}

export function normalizeTemplateBidPackage(input: {
  readonly title: string
  readonly description: string | null
  readonly payloadJson: string | null
}): NormalizedTemplateBidPackage {
  const payload = parsePayloadJson(input.payloadJson)
  const overallScope = formatNarrative(payload, input.description)
  const scopeItems = normalizeScopeItems(payload)
  const documentLinks = normalizeDocumentLinks(payload)
  const unresolvedPlaceholders = findTemplatePlaceholders([
    input.title,
    overallScope,
    ...scopeItems.flatMap((line) => [line.description, line.notes]),
  ])
  const requiresDocumentPackage =
    sectionLines(payload, input.description).some(
      (line) => line.toLowerCase() === "reference documents"
    ) && documentLinks.length === 0
  const templateReview =
    unresolvedPlaceholders.length > 0 || requiresDocumentPackage
      ? { unresolvedPlaceholders, requiresDocumentPackage }
      : null

  return {
    overallScope,
    vendorCategory: inferVendorCategory(input.title, scopeItems),
    scopeItems,
    documentLinks,
    primaryCostCode: scopeItems[0]?.costCode ?? null,
    templateReview,
  }
}
