import { z } from "zod/v4"

/**
 * Settings → Workflows → Trade docs: what each kind of vendor must have on
 * file. Vendor kinds are the directory's vendor categories ("Subcontractor",
 * "Supplier", ...), so every company can use its own.
 */

export const TRADE_DOC_BILL_MODES = ["flag", "hold", "off"] as const
export type TradeDocBillMode = (typeof TRADE_DOC_BILL_MODES)[number]

export const TRADE_DOC_BILL_MODE_LABELS: Readonly<Record<TradeDocBillMode, string>> = {
  flag: "Flag the bill",
  hold: "Hold payment",
  off: "Do nothing",
}

const tradeDocTypeSchema = z.object({
  /** Stored on documents; never reuse an id for a different meaning. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, "Use lowercase letters, numbers and dashes for the id."),
  label: z.string().trim().min(1).max(60),
  /** Vendor categories that must have this document. */
  requiredFor: z.array(z.string().trim().min(1).max(60)).max(20),
  expires: z.boolean(),
  /** Days before expiry to start warning (and, later, to remind the vendor). */
  remindDaysBefore: z.number().int().min(0).max(180),
  /** An accepted alternative, e.g. "No employees" forms instead of a workers' comp certificate. */
  waiverLabel: z.string().trim().max(160).nullable(),
  /** Show the certificate checklist when staff record this document. */
  certificateChecks: z.boolean(),
  active: z.boolean(),
  /** A blank form in Drive (link or id) the vendor can download from their docs link. */
  formLink: z.string().trim().max(300).nullable().default(null),
  /** The blank alternative forms, e.g. the no-employees declaration. */
  waiverFormLink: z.string().trim().max(300).nullable().default(null),
})
export type TradeDocType = z.infer<typeof tradeDocTypeSchema>

export const INFO_SHEET_FIELD_KINDS = ["text", "long_text", "email", "phone", "choice", "yes_no"] as const
export type InfoSheetFieldKind = (typeof INFO_SHEET_FIELD_KINDS)[number]

export const INFO_SHEET_FIELD_KIND_LABELS: Readonly<Record<InfoSheetFieldKind, string>> = {
  text: "Short answer",
  long_text: "Long answer",
  email: "Email",
  phone: "Phone",
  choice: "Pick one",
  yes_no: "Yes or no",
}

/** Fields Compass acts on: the agent's details let the vendor send the certificate request on. */
export const INFO_SHEET_FIELD_PURPOSES = ["none", "agent_name", "agent_email"] as const
export type InfoSheetFieldPurpose = (typeof INFO_SHEET_FIELD_PURPOSES)[number]

const infoSheetFieldSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, "Use lowercase letters, numbers and dashes for the id."),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(INFO_SHEET_FIELD_KINDS),
  /** Choices for a "Pick one" field. */
  options: z.array(z.string().trim().min(1).max(60)).max(12),
  required: z.boolean(),
  active: z.boolean(),
  purpose: z.enum(INFO_SHEET_FIELD_PURPOSES),
})
export type InfoSheetField = z.infer<typeof infoSheetFieldSchema>

const infoSheetSettingsSchema = z.object({
  /** The document type the online info sheet fills; null turns the online form off. */
  docTypeId: z.string().max(40).nullable(),
  fields: z.array(infoSheetFieldSchema).min(1).max(40),
  /** The statement the vendor signs by typing their name. */
  certification: z.string().trim().min(1).max(400),
})
export type InfoSheetSettings = z.infer<typeof infoSheetSettingsSchema>

/**
 * Letters to selected trades. The texts take {company}, {vendor}, {project},
 * {quote}, {agreement} and {owed}; the scope table and signatures are added
 * by Compass.
 */
const tradeLetterSettingsSchema = z.object({
  /** The document type that is the master agreement a trade signs once. */
  agreementDocTypeId: z.string().max(40).nullable(),
  intentText: z.string().trim().min(1).max(3000),
  awardText: z.string().trim().min(1).max(3000),
  /** Added when documents are still owed. */
  owedText: z.string().trim().max(1500),
  closingText: z.string().trim().max(3000),
  /** The title printed under the company signer's name. */
  companySignerTitle: z.string().trim().max(80),
})
export type TradeLetterSettings = z.infer<typeof tradeLetterSettingsSchema>

export const DEFAULT_TRADE_LETTER_SETTINGS: TradeLetterSettings = {
  agreementDocTypeId: "trade-agreement",
  intentText:
    "{company} intends to award {vendor} the work below on {project}, based on your quote {quote}. This letter holds your place on the job while the owner's contract is completed. It is not an award: the award letter follows once the owner signs, and no work should start before then.",
  awardText:
    "{company} accepts in writing your quote {quote} for the work below on {project}. The work is governed by our Trade Contractor Agreement, {agreement}.",
  owedText:
    "Documents still needed: {owed}. Per Article 2.2 of the Trade Contractor Agreement, no payment can be made until these are received.",
  closingText:
    "Your work will be scheduled per the project schedule. Any change to this scope needs a written change order before the work is done.",
  companySignerTitle: "",
}

/**
 * Keeping Sage's vendor certificates in step with the trade docs. While
 * warnOnly is on, every vendor gets warnings only, even those set to hold
 * payment, so payments aren't stopped before documents are collected.
 */
const tradeDocSageSettingsSchema = z.object({
  enabled: z.boolean(),
  warnOnly: z.boolean(),
  /** Sage's certificate description per document type id, when it differs from the label. */
  names: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), z.string().trim().max(50)),
})
export type TradeDocSageSettings = z.infer<typeof tradeDocSageSettingsSchema>

export const DEFAULT_TRADE_DOC_SAGE_SETTINGS: TradeDocSageSettings = { enabled: false, warnOnly: true, names: {} }

export const tradeDocSettingsSchema = z.object({
  docTypes: z.array(tradeDocTypeSchema).min(1).max(30),
  /** What staff confirm on an insurance certificate before accepting it. */
  certificateChecks: z.array(z.string().trim().min(1).max(120)).max(20),
  /** Drive folder that holds one folder per vendor; blank uses the company's Drive root. */
  driveFolderId: z.string().trim().max(200).nullable(),
  /** What happens to a vendor's bills while required docs are missing. */
  billModeDefault: z.enum(TRADE_DOC_BILL_MODES),
  /** Whose name, logo and contact lines vendors see on the request and their page. */
  brandDepartment: z.enum(["O", "H", "N", "D"]).default("H"),
  /** How long a vendor's docs link keeps working. */
  linkDays: z.number().int().min(1).max(180).default(30),
  /** Opening note on the docs request email and the vendor's page. */
  requestNote: z.string().trim().max(1500).default(""),
  /** Who certificates should name and where agents send them; blank uses the company's name and contact lines. */
  certificateHolder: z.string().trim().max(800).default(""),
  infoSheet: infoSheetSettingsSchema.default(() => DEFAULT_INFO_SHEET),
  letters: tradeLetterSettingsSchema.default(() => DEFAULT_TRADE_LETTER_SETTINGS),
  sage: tradeDocSageSettingsSchema.default(() => DEFAULT_TRADE_DOC_SAGE_SETTINGS),
})
export type TradeDocSettings = z.infer<typeof tradeDocSettingsSchema>

export const DEFAULT_TRADE_DOC_TYPES: readonly TradeDocType[] = [
  { id: "w9", label: "W-9", requiredFor: ["Subcontractor", "Supplier"], expires: false, remindDaysBefore: 0, waiverLabel: null, certificateChecks: false, active: true, formLink: null, waiverFormLink: null },
  { id: "gl-certificate", label: "General liability certificate", requiredFor: ["Subcontractor"], expires: true, remindDaysBefore: 30, waiverLabel: null, certificateChecks: true, active: true, formLink: null, waiverFormLink: null },
  {
    id: "wc-certificate",
    label: "Workers' comp certificate",
    requiredFor: ["Subcontractor"],
    expires: true,
    remindDaysBefore: 30,
    waiverLabel: "No employees: coverage rejection and independent contractor declaration",
    certificateChecks: true,
    active: true,
    formLink: null,
    waiverFormLink: null,
  },
  { id: "business-license", label: "Business license", requiredFor: ["Subcontractor"], expires: true, remindDaysBefore: 30, waiverLabel: null, certificateChecks: false, active: true, formLink: null, waiverFormLink: null },
  { id: "trade-agreement", label: "Trade contractor agreement", requiredFor: ["Subcontractor"], expires: false, remindDaysBefore: 0, waiverLabel: null, certificateChecks: false, active: true, formLink: null, waiverFormLink: null },
  { id: "info-sheet", label: "Subcontractor info sheet", requiredFor: ["Subcontractor"], expires: false, remindDaysBefore: 0, waiverLabel: null, certificateChecks: false, active: true, formLink: null, waiverFormLink: null },
]

const DEFAULT_CERTIFICATE_CHECKS: readonly string[] = [
  "Limits meet our minimums",
  "We are named as additional insured",
  "Waiver of subrogation included",
  "30-day notice of cancellation",
  "Expiration date entered",
]

function field(id: string, label: string, kind: InfoSheetFieldKind, required: boolean, extra: Partial<Pick<InfoSheetField, "options" | "purpose">> = {}): InfoSheetField {
  return { id, label, kind, options: extra.options ?? [], required, active: true, purpose: extra.purpose ?? "none" }
}

export const DEFAULT_INFO_SHEET: InfoSheetSettings = {
  docTypeId: "info-sheet",
  fields: [
    field("legal-name", "Company legal name", "text", true),
    field("dba", "DBA", "text", false),
    field("address", "Business address", "long_text", true),
    field("phone", "Business telephone", "phone", true),
    field("email", "Email", "email", true),
    field("entity", "Business type", "choice", true, { options: ["Corporation", "Partnership", "Sole proprietor", "LLC"] }),
    field("officers", "Officers' names and titles", "long_text", false),
    field("license", "Contractor's license #", "text", false),
    field("federal-id", "Federal ID #", "text", true),
    field("employees", "Do you have employees?", "yes_no", true),
    field("wc-account", "Workers' compensation account number", "text", false),
    field("agency", "Insurance agency", "text", true),
    field("agency-phone", "Insurance agency phone", "phone", false),
    field("agent-name", "Agent's name", "text", false, { purpose: "agent_name" }),
    field("agent-email", "Agent's email", "email", false, { purpose: "agent_email" }),
  ],
  certification: "By signing this form, I certify that the above information is true and correct.",
}

export const DEFAULT_TRADE_DOC_SETTINGS: TradeDocSettings = {
  docTypes: [...DEFAULT_TRADE_DOC_TYPES],
  certificateChecks: [...DEFAULT_CERTIFICATE_CHECKS],
  driveFolderId: null,
  billModeDefault: "flag",
  brandDepartment: "H",
  linkDays: 30,
  requestNote: "",
  certificateHolder: "",
  infoSheet: DEFAULT_INFO_SHEET,
  letters: DEFAULT_TRADE_LETTER_SETTINGS,
  sage: DEFAULT_TRADE_DOC_SAGE_SETTINGS,
}

/** Accepts a Drive folder link or a bare id; returns the id or null. */
export function driveFolderIdFromInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/\/folders\/([A-Za-z0-9_-]{10,})/)
  if (fromUrl?.[1]) return fromUrl[1]
  const fromQuery = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (fromQuery?.[1]) return fromQuery[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null
}

/** Accepts a Drive file link or a bare id; returns the id or null. */
export function driveFileIdFromInput(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  const fromPath = trimmed.match(/\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d)\/([A-Za-z0-9_-]{10,})/)
  if (fromPath?.[1]) return fromPath[1]
  const fromQuery = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/)
  if (fromQuery?.[1]) return fromQuery[1]
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null
}

export function isTradeDocBillMode(value: unknown): value is TradeDocBillMode {
  return TRADE_DOC_BILL_MODES.some((mode) => mode === value)
}
