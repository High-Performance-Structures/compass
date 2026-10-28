import type { TradeDocType } from "@/lib/trade-docs/settings"

/**
 * Bringing existing trade docs in from Google Drive. Companies keep them in
 * one of two ways, often both:
 *
 * - a folder per vendor, holding that vendor's documents;
 * - a folder per kind of document (W-9s, insurance certificates), with the
 *   vendor's name and often the expiry dates in each file name, e.g.
 *   "Fox Excavation LLC GL5-01-2026WC10-01-2026.pdf".
 *
 * Everything here only proposes; staff review the list before anything is
 * recorded.
 */

export const IMPORT_LAYOUTS = ["vendor-folders", "file-names"] as const
export type ImportLayout = (typeof IMPORT_LAYOUTS)[number]

export type DriveFileForImport = {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly modifiedTime: string | null
  readonly webUrl: string | null
  /** Folder names from the scanned folder down to the file's folder. */
  readonly folderPath: readonly string[]
}

export type VendorForMatch = { readonly id: string; readonly name: string }

export type ImportProposal = {
  /** `${fileId}:${docType}`; one file can hold two documents (GL and WC). */
  readonly key: string
  readonly fileId: string
  readonly fileName: string
  readonly webUrl: string | null
  readonly folderPath: readonly string[]
  readonly vendorId: string | null
  readonly docType: string | null
  readonly kind: "document" | "waiver"
  readonly expiresOn: string | null
  /** Proposed for import; staff can change it. */
  readonly selected: boolean
  /** Why it isn't selected, or what to check. */
  readonly note: string | null
}

const COMPANY_WORDS = new Set(["llc", "inc", "incorporated", "co", "corp", "corporation", "company", "ltd", "the", "pc", "pllc", "lp", "llp"])
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

function words(value: string): readonly string[] {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !COMPANY_WORDS.has(word))
}

function compact(value: string): string {
  return words(value).join("")
}

function withoutExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,5}$/, "")
}

/**
 * The vendor a name refers to, scored 0–100. Handles squashed names
 * ("SummitConc" for Summit Concrete) and company suffixes.
 */
export function matchVendor(text: string, vendors: readonly VendorForMatch[]): { readonly vendor: VendorForMatch; readonly score: number } | null {
  const target = compact(text)
  if (target.length < 3) return null
  const firstWord = words(text)[0] ?? ""
  let best: { readonly vendor: VendorForMatch; readonly score: number; readonly length: number } | null = null
  for (const vendor of vendors) {
    const name = compact(vendor.name)
    if (!name) continue
    let score = 0
    if (target === name) score = 100
    else if (name.length >= 4 && target.startsWith(name)) score = 85
    else if (target.length >= 6 && name.startsWith(target)) score = 70
    else if (firstWord.length >= 5 && words(vendor.name)[0] === firstWord) score = 45
    if (score === 0) continue
    if (!best || score > best.score || (score === best.score && name.length > best.length)) {
      best = { vendor, score, length: name.length }
    }
  }
  return best ? { vendor: best.vendor, score: best.score } : null
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function isoDate(year: number, month: number, day: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year
  if (fullYear < 2000 || fullYear > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${fullYear}-${pad(month)}-${pad(day)}`
}

type FoundDate = { readonly index: number; readonly end: number; readonly date: string }

/** Dates written like 5-01-2026, 2-10-26, 10.1.24 or 24Mar2027. */
export function findDates(text: string): readonly FoundDate[] {
  const found: FoundDate[] = []
  const numeric = /(?<!\d)(\d{1,2})[-./_](\d{1,2})[-./_](\d{4}|\d{2})(?!\d)/g
  for (const match of text.matchAll(numeric)) {
    const date = isoDate(Number(match[3]), Number(match[1]), Number(match[2]))
    if (date && match.index !== undefined) found.push({ index: match.index, end: match.index + match[0].length, date })
  }
  const named = /(?<!\d)(\d{1,2})\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?(\d{4})/gi
  for (const match of text.matchAll(named)) {
    const month = MONTHS.indexOf((match[2] ?? "").toLowerCase()) + 1
    const date = isoDate(Number(match[3]), month, Number(match[1]))
    if (date && match.index !== undefined) found.push({ index: match.index, end: match.index + match[0].length, date })
  }
  return found.sort((a, b) => a.index - b.index)
}

/**
 * General liability and workers' comp expiry dates from a certificate's file
 * name: "GL6-28-2026 WC10-01-2026", "GLWC3-18-2026", "GL WC 8-1-2026",
 * "WC1-1-26-LIAB1-7-26". Labels are matched in capitals so "Glass" isn't GL.
 */
export function certificateDates(fileName: string): { readonly gl: string | null; readonly wc: string | null; readonly labelIndex: number | null } {
  const name = withoutExtension(fileName)
  const dates = findDates(name)
  const labels = [...name.matchAll(/GL|WC|LIAB/g)].filter((match) => match.index !== undefined)
  let gl: string | null = null
  let wc: string | null = null
  let cursor = 0
  for (const date of dates) {
    // Labels between the previous date and this one belong to this date.
    const pending = labels.filter((label) => (label.index ?? 0) >= cursor && (label.index ?? 0) < date.index).map((label) => label[0])
    if (pending.includes("GL") || pending.includes("LIAB")) gl = date.date
    if (pending.includes("WC")) wc = date.date
    cursor = date.end
  }
  return { gl, wc, labelIndex: labels[0]?.index ?? null }
}

type Detected = { readonly docType: string; readonly kind: "document" | "waiver"; readonly expiresOn: string | null }

const W9 = /w-?9(?![0-9])/i
const DECLARATION = /declaration|independent contractor|rejection of coverage|coverage rejection/i
const INFO_SHEET = /info(rmation)?\s*sheet|general information/i
const AGREEMENT = /agreement|contract(?!or)|\btca\b/i
const LICENSE = /licen[sc]e|bus\.?\s*lic/i
const INSURANCE = /\bcoi\b|certificate of insurance|insurance|acord/i

function activeType(docTypes: readonly TradeDocType[], id: string): boolean {
  return docTypes.some((type) => type.id === id && type.active)
}

/** Which of the company's document types a file name looks like. */
export function detectDocTypes(fileName: string, docTypes: readonly TradeDocType[]): readonly Detected[] {
  const name = withoutExtension(fileName)
  const found: Detected[] = []
  const add = (docType: string, kind: Detected["kind"] = "document", expiresOn: string | null = null): void => {
    if (activeType(docTypes, docType) && !found.some((item) => item.docType === docType)) found.push({ docType, kind, expiresOn })
  }
  const cert = certificateDates(name)
  if (cert.gl) add("gl-certificate", "document", cert.gl)
  if (cert.wc) add("wc-certificate", "document", cert.wc)
  if (DECLARATION.test(name)) add("wc-certificate", "waiver")
  if (W9.test(name)) add("w9")
  if (INFO_SHEET.test(name)) add("info-sheet")
  if (AGREEMENT.test(name) && !DECLARATION.test(name)) add("trade-agreement")
  if (LICENSE.test(name)) {
    const dates = findDates(name)
    add("business-license", "document", dates[dates.length - 1]?.date ?? null)
  }
  if (found.length === 0 && INSURANCE.test(name)) add("gl-certificate")
  // Company-defined types match on their label.
  for (const type of docTypes) {
    if (type.active && !found.some((item) => item.docType === type.id) && name.toLowerCase().includes(type.label.toLowerCase())) add(type.id)
  }
  return found
}

/** The part of a file name before the document words and dates: usually the vendor. */
export function vendorPartOfFileName(fileName: string): string {
  const name = withoutExtension(fileName)
  const stops = [
    certificateDates(name).labelIndex,
    name.search(W9),
    name.search(/\bCOI\b|certificate|insurance|declaration|independent|info(rmation)?\s*sheet|trade\s*(contractor\s*)?agreement|agreement|business\s*licen|licen[sc]e/i),
    findDates(name)[0]?.index ?? -1,
  ].filter((index): index is number => index !== null && index > 0)
  const end = stops.length > 0 ? Math.min(...stops) : name.length
  return name.slice(0, end).replace(/[-_.,\s]+$/, "").trim()
}

const SKIP_MIME = /^application\/vnd\.google-apps\.(folder|shortcut)$/
const WORD_FILE = /\.(docx?|dotx?)$/i
const SIGNED = /signed|executed/i

/**
 * Proposals for one scanned folder. In "vendor-folders" the first folder
 * below the scanned one names the vendor; in "file-names" the file name does.
 * `defaultDocType` applies when a file name names no document.
 */
export function proposeImports(input: {
  readonly files: readonly DriveFileForImport[]
  readonly layout: ImportLayout
  readonly defaultDocType: string | null
  readonly vendors: readonly VendorForMatch[]
  readonly docTypes: readonly TradeDocType[]
  /** Drive file ids already recorded, so they aren't offered again. */
  readonly alreadyRecorded: ReadonlySet<string>
}): readonly ImportProposal[] {
  const raw: (ImportProposal & { readonly modifiedTime: string | null; readonly signed: boolean })[] = []
  const folderVendor = new Map<string, ReturnType<typeof matchVendor>>()
  for (const file of input.files) {
    if (SKIP_MIME.test(file.mimeType) || input.alreadyRecorded.has(file.id)) continue
    let match: ReturnType<typeof matchVendor>
    if (input.layout === "vendor-folders") {
      const folder = file.folderPath[0] ?? ""
      if (!folderVendor.has(folder)) folderVendor.set(folder, folder ? matchVendor(folder, input.vendors) : null)
      match = folderVendor.get(folder) ?? null
    } else {
      match = matchVendor(vendorPartOfFileName(file.name), input.vendors)
    }
    const detected = detectDocTypes(file.name, input.docTypes)
    const types: readonly Detected[] =
      detected.length > 0
        ? detected
        : input.defaultDocType && activeType(input.docTypes, input.defaultDocType)
          ? [{ docType: input.defaultDocType, kind: "document", expiresOn: null }]
          : [{ docType: "", kind: "document", expiresOn: null }]
    for (const type of types) {
      const docType = type.docType || null
      const notes: string[] = []
      if (!match) notes.push("No vendor matched")
      else if (match.score < 60) notes.push("Check the vendor")
      if (!docType) notes.push("Choose the document")
      if (docType === "trade-agreement" && WORD_FILE.test(file.name)) notes.push("Word file, probably the blank template")
      raw.push({
        key: `${file.id}:${docType ?? "unknown"}`,
        fileId: file.id,
        fileName: file.name,
        webUrl: file.webUrl,
        folderPath: file.folderPath,
        vendorId: match?.vendor.id ?? null,
        docType,
        kind: type.kind,
        expiresOn: type.expiresOn,
        selected: notes.length === 0,
        note: notes.length > 0 ? notes.join("; ") : null,
        modifiedTime: file.modifiedTime,
        signed: SIGNED.test(file.name),
      })
    }
  }

  // Keep one current document per vendor and type: the latest expiry, a
  // signed copy over an unsigned one, then the most recently changed.
  const rank = (item: (typeof raw)[number]): string =>
    `${item.expiresOn ?? "0000-00-00"}|${item.signed ? 1 : 0}|${WORD_FILE.test(item.fileName) ? 0 : 1}|${item.modifiedTime ?? ""}`
  const bestKey = new Map<string, string>()
  for (const item of raw) {
    if (!item.selected || !item.vendorId || !item.docType) continue
    const group = `${item.vendorId}:${item.docType}`
    const current = raw.find((other) => other.key === bestKey.get(group))
    if (!current || rank(item) > rank(current)) bestKey.set(group, item.key)
  }
  return raw.map(({ modifiedTime: _modified, signed: _signed, ...item }) => {
    if (!item.selected || !item.vendorId || !item.docType) return item
    if (bestKey.get(`${item.vendorId}:${item.docType}`) === item.key) return item
    return { ...item, selected: false, note: "Older or duplicate copy" }
  })
}
