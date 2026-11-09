/**
 * Reading choice templates from a CSV file. One row per choice; rows with
 * the same template name make one template. Columns are found by their
 * header (any case and spacing):
 *
 *   Template (required), Category, Title (required), Description,
 *   Supplier, Supplier price, Owner price, Lead time days, Product URL
 *
 * Pure: the browser previews with it and the server checks again on import.
 */
import { toCents } from "@/lib/format"
import { cleanText } from "@/lib/shared/guards"

type ChoiceTemplateItemDraft = {
  readonly title: string
  readonly description: string | null
  readonly supplierName: string | null
  readonly priceCents: number | null
  readonly ownerPriceCents: number | null
  readonly leadTimeDays: number | null
  readonly productUrl: string | null
}

type ChoiceTemplateDraft = {
  readonly name: string
  readonly category: string | null
  readonly items: readonly ChoiceTemplateItemDraft[]
}

export type ChoiceTemplateCsvResult = {
  readonly templates: readonly ChoiceTemplateDraft[]
  /** "Row 4: …" problems; those rows are left out. */
  readonly errors: readonly string[]
}

const MAX_ROWS = 2000

/** RFC 4180 rows: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsvRows(text: string): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const source = text.replace(/^﻿/, "")
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""))
}

const HEADERS = {
  template: ["template", "template name"],
  category: ["category"],
  title: ["title", "choice", "choice title"],
  description: ["description"],
  supplier: ["supplier", "vendor"],
  price: ["supplier price", "price", "cost"],
  ownerPrice: ["owner price"],
  leadTime: ["lead time days", "lead time", "lead days"],
  url: ["product url", "url", "link"],
} as const

type HeaderKey = keyof typeof HEADERS
const HEADER_KEYS: readonly HeaderKey[] = ["template", "category", "title", "description", "supplier", "price", "ownerPrice", "leadTime", "url"]

function headerIndex(header: readonly string[]): Partial<Record<HeaderKey, number>> {
  const normalized = header.map((cell) => cell.trim().toLocaleLowerCase().replace(/\s+/g, " "))
  const found: Partial<Record<HeaderKey, number>> = {}
  for (const key of HEADER_KEYS) {
    const index = normalized.findIndex((cell) => HEADERS[key].some((name) => name === cell))
    if (index >= 0) found[key] = index
  }
  return found
}

/** The cell's trimmed text cut to `max`, or null when blank. */
function cellText(value: string | undefined, max: number): string | null {
  return cleanText(value)?.slice(0, max) ?? null
}

export function parseChoiceTemplateCsv(csv: string): ChoiceTemplateCsvResult {
  const [header, ...rows] = parseCsvRows(csv)
  if (!header) return { templates: [], errors: ["The file is empty."] }
  const columns = headerIndex(header)
  if (columns.template === undefined || columns.title === undefined) {
    return { templates: [], errors: ["The first row needs Template and Title columns."] }
  }
  if (rows.length > MAX_ROWS) return { templates: [], errors: [`Import no more than ${MAX_ROWS} rows at a time.`] }

  const errors: string[] = []
  const byName = new Map<string, { name: string; category: string | null; items: ChoiceTemplateItemDraft[] }>()
  rows.forEach((cells, at) => {
    const rowNumber = at + 2
    const cell = (key: HeaderKey): string | undefined => {
      const index = columns[key]
      return index === undefined ? undefined : cells[index]
    }
    const name = cellText(cell("template"), 120)
    const title = cellText(cell("title"), 200)
    if (!name || !title) {
      errors.push(`Row ${rowNumber}: needs a template name and a title.`)
      return
    }
    const cellCents = (key: HeaderKey): number | null | "bad" => {
      const raw = cellText(cell(key), 40)
      if (!raw) return null
      const cents = toCents(raw)
      return cents === null || cents < 0 ? "bad" : cents
    }
    const priceCents = cellCents("price")
    const ownerPriceCents = cellCents("ownerPrice")
    const leadRaw = cellText(cell("leadTime"), 10)
    const leadTimeDays = leadRaw === null ? null : Number(leadRaw)
    if (priceCents === "bad" || ownerPriceCents === "bad") {
      errors.push(`Row ${rowNumber}: prices must be dollar amounts.`)
      return
    }
    if (leadTimeDays !== null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 730)) {
      errors.push(`Row ${rowNumber}: lead time must be whole days from 0 to 730.`)
      return
    }
    const url = cellText(cell("url"), 2000)
    if (url && !/^https?:\/\//i.test(url)) {
      errors.push(`Row ${rowNumber}: the product URL must start with http:// or https://.`)
      return
    }
    const key = name.toLocaleLowerCase()
    const template = byName.get(key) ?? { name, category: cellText(cell("category"), 80), items: [] }
    template.items.push({
      title,
      description: cellText(cell("description"), 4000),
      supplierName: cellText(cell("supplier"), 200),
      priceCents,
      ownerPriceCents,
      leadTimeDays,
      productUrl: url,
    })
    byName.set(key, template)
  })
  return { templates: [...byName.values()], errors }
}
