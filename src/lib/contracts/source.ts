export const ORC_CONTRACT_SOURCE_WORKBOOK_ID =
  "1KvlCuzkcMMX6FNIOEJdbAXGlbJKvosMuZVv0JWGSwYg"

export const ORC_CONTRACT_SOURCE_URL =
  `https://docs.google.com/spreadsheets/d/${ORC_CONTRACT_SOURCE_WORKBOOK_ID}/edit`

export type ContractSigningStage =
  | "contract"
  | "construction"
  | "closeout"
  | "reference"

export type ContractInclusionMode = "embedded" | "reference" | "generated"

type SourceSegment = {
  readonly sheetName: string
  readonly startRow: number
  readonly endRow: number
  readonly kind: "paragraphs" | "table"
}

export type OrcContractSourceDefinition = {
  readonly code: string
  readonly name: string
  readonly category: "agreement" | "general_conditions" | "exhibit" | "form" | "manual" | "generated"
  readonly signingStage: ContractSigningStage
  readonly defaultInclusionMode: ContractInclusionMode
  readonly sheetNames: readonly string[]
  readonly segments: readonly SourceSegment[]
  readonly sortOrder: number
}

export const ORC_CONTRACT_SOURCE_DEFINITIONS: readonly OrcContractSourceDefinition[] = [
  {
    code: "CA00",
    name: "Cost Plus - Fixed Fee Contract",
    category: "agreement",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA00 Cost Plus"],
    segments: [
      { sheetName: "CA00 Cost Plus", startRow: 25, endRow: 27, kind: "paragraphs" },
      { sheetName: "CA00 Cost Plus", startRow: 45, endRow: 125, kind: "paragraphs" },
    ],
    sortOrder: 0,
  },
  {
    code: "CA01",
    name: "General Conditions",
    category: "general_conditions",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA01 General Conditions"],
    segments: [
      { sheetName: "CA01 General Conditions", startRow: 25, endRow: 127, kind: "paragraphs" },
    ],
    sortOrder: 10,
  },
  {
    code: "CA11",
    name: "Inspection Checklist and Walk-Through Process",
    category: "form",
    signingStage: "closeout",
    defaultInclusionMode: "embedded",
    sheetNames: [
      "CA11 Inspection Check List",
      "CA11 Inspection Check List (2)",
      "CA11 Inspection Check List (3)",
    ],
    segments: [
      { sheetName: "CA11 Inspection Check List", startRow: 23, endRow: 23, kind: "paragraphs" },
      { sheetName: "CA11 Inspection Check List (2)", startRow: 1, endRow: 38, kind: "table" },
      { sheetName: "CA11 Inspection Check List (3)", startRow: 1, endRow: 2, kind: "paragraphs" },
      { sheetName: "CA11 Inspection Check List (3)", startRow: 15, endRow: 16, kind: "paragraphs" },
    ],
    sortOrder: 20,
  },
  {
    code: "CA12",
    name: "Limited Warranty",
    category: "exhibit",
    signingStage: "closeout",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA12 Limited Warranty"],
    segments: [
      { sheetName: "CA12 Limited Warranty", startRow: 22, endRow: 54, kind: "paragraphs" },
    ],
    sortOrder: 30,
  },
  {
    code: "CA15",
    name: "Change Order Basics",
    category: "exhibit",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA15 Change Order Basics"],
    segments: [
      { sheetName: "CA15 Change Order Basics", startRow: 27, endRow: 80, kind: "paragraphs" },
      { sheetName: "CA15 Change Order Basics", startRow: 81, endRow: 89, kind: "table" },
      { sheetName: "CA15 Change Order Basics", startRow: 90, endRow: 93, kind: "paragraphs" },
    ],
    sortOrder: 40,
  },
  {
    code: "CA17",
    name: "Reimbursable Expenses",
    category: "exhibit",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA17 Reimbursable Expenses"],
    segments: [
      { sheetName: "CA17 Reimbursable Expenses", startRow: 23, endRow: 23, kind: "paragraphs" },
      { sheetName: "CA17 Reimbursable Expenses", startRow: 24, endRow: 36, kind: "table" },
      { sheetName: "CA17 Reimbursable Expenses", startRow: 37, endRow: 38, kind: "paragraphs" },
    ],
    sortOrder: 50,
  },
  {
    code: "CA18",
    name: "Homeowner's Warranty Manual",
    category: "manual",
    signingStage: "reference",
    defaultInclusionMode: "reference",
    sheetNames: [],
    segments: [],
    sortOrder: 60,
  },
  {
    code: "CA19",
    name: "Allowances and Finish Schedules",
    category: "exhibit",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA19 Allowances and Finishes Sc"],
    segments: [
      { sheetName: "CA19 Allowances and Finishes Sc", startRow: 24, endRow: 46, kind: "paragraphs" },
      { sheetName: "CA19 Allowances and Finishes Sc", startRow: 47, endRow: 53, kind: "table" },
      { sheetName: "CA19 Allowances and Finishes Sc", startRow: 54, endRow: 55, kind: "paragraphs" },
    ],
    sortOrder: 70,
  },
  {
    code: "CA20",
    name: "HPS Inspection Process",
    category: "exhibit",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA20 HPS Inspection Process"],
    segments: [
      { sheetName: "CA20 HPS Inspection Process", startRow: 24, endRow: 30, kind: "paragraphs" },
    ],
    sortOrder: 80,
  },
  {
    code: "CA21",
    name: "HPS Labor Scope",
    category: "exhibit",
    signingStage: "contract",
    defaultInclusionMode: "embedded",
    sheetNames: ["CA21 HPS Labor Scope"],
    segments: [
      { sheetName: "CA21 HPS Labor Scope", startRow: 21, endRow: 32, kind: "paragraphs" },
    ],
    sortOrder: 90,
  },
  {
    code: "CA22",
    name: "Construction Estimate",
    category: "generated",
    signingStage: "contract",
    defaultInclusionMode: "generated",
    sheetNames: [],
    segments: [],
    sortOrder: 100,
  },
] as const

const SOURCE_ROW_OVERRIDES: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  "CA00 Cost Plus": {
    27: "## Article 1.2 Specific Contract Documents\n\n{{contract.document_schedule}}",
    48: "{{project.location}}",
    52: "{{contract.commencement_date}}",
    54: "{{contract.completion_date}}",
    56: "{{contract.execution_date}}",
    59: "The construction coordination services fee (overhead/margin/builder contingency) shall be charged at {{estimate.builder_fee_percent}} of the Construction Estimate dated {{estimate.date}}.",
    60: "",
    61: "The construction coordination services fee is {{estimate.builder_fee_words}},",
    62: "{{estimate.builder_fee_total}}.",
    65: "Article 4.2. Pre-construction estimates for construction costs and coordination are approximately {{estimate.total_words}},",
    66: "{{estimate.total}}.",
    68: "Article 4.3. The Owner and the Contractor acknowledge that the Owner will pay {{contract.deposit_words}},",
    69: "{{contract.deposit}}, upon signing of this contract, after Owner receives construction financing, and before construction begins as a deposit and part of the purchase price of the project.",
    70: "",
    73: "Article 5.1. The Owner will make payments to the Contractor monthly based on invoices for labor and materials submitted. Construction coordination fees shall also be paid with those draws. Owner shall make payments to Contractor within 10 days after request. Should the Owner fail to make payment within 30 days, Contractor may charge a penalty of {{contract.late_payment_percent}} annually upon the unpaid amount until paid. Should the lender require additional information, documentation, or verification after inspection that delays the release of funds, no penalties shall be applied.",
  },
  "CA12 Limited Warranty": {
    22: "Whereas, Contractor has built a Project located in the County of {{project.county}}, State of Colorado, at {{project.address}}, and",
    23: "",
  },
}

export type ContractSourceRows = Readonly<Record<string, readonly (readonly unknown[])[]>>

function cleanCell(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
    : ""
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|")
}

function paragraphLine(value: string): string {
  if (/^·\s*/.test(value)) return `- ${value.replace(/^·\s*/, "")}`
  if (
    /^(Article\s+\d+\.?\s+[A-Z][A-Z\s,&/-]+|What\s|Why\s|How\s|When\s|Change Order Fees$|Value Engineering and Value Engineering Fees$|Allowance vs\. Option$|Finish Schedule$|Finish Schedule Requirements$|Cutoff Points for Changes$|First Inspection$|Second Inspection$)/.test(
      value
    )
  ) {
    return `## ${value}`
  }
  return value
}

function sourceRow(
  sheetName: string,
  rowNumber: number,
  rows: readonly (readonly unknown[])[]
): readonly string[] {
  const override = SOURCE_ROW_OVERRIDES[sheetName]?.[rowNumber]
  if (override !== undefined) return override ? [override] : []
  const row = rows[rowNumber - 1] ?? []
  return row.map(cleanCell).filter(Boolean)
}

function paragraphSegment(
  segment: SourceSegment,
  rows: readonly (readonly unknown[])[]
): string {
  const output: string[] = []
  for (let rowNumber = segment.startRow; rowNumber <= segment.endRow; rowNumber += 1) {
    const cells = sourceRow(segment.sheetName, rowNumber, rows)
    if (cells.length === 0) continue
    const value = cells.join(" — ")
    output.push(paragraphLine(value))
  }
  return output.join("\n\n")
}

function tableSegment(
  segment: SourceSegment,
  rows: readonly (readonly unknown[])[]
): string {
  const tableRows: readonly string[][] = Array.from(
    { length: segment.endRow - segment.startRow + 1 },
    (_, index) => sourceRow(segment.sheetName, segment.startRow + index, rows).map(markdownCell)
  ).filter((row) => row.length > 0)
  if (tableRows.length === 0) return ""
  const width = Math.max(...tableRows.map((row) => row.length))
  const normalized = tableRows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ])
  const [header, ...body] = normalized
  if (!header) return ""
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n")
}

export function normalizeContractSourceDocument(input: {
  readonly definition: OrcContractSourceDefinition
  readonly rows: ContractSourceRows
}): string {
  if (input.definition.code === "CA18") {
    return "The Homeowner's Warranty Manual is incorporated by reference and delivered separately. The full handbook is not embedded in the contract packet."
  }
  if (input.definition.code === "CA22") {
    return "The selected Compass construction estimate is generated and inserted at packet preparation time."
  }
  return input.definition.segments
    .map((segment) => {
      const rows = input.rows[segment.sheetName] ?? []
      return segment.kind === "table"
        ? tableSegment(segment, rows)
        : paragraphSegment(segment, rows)
    })
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

export function contractSourceRanges(): readonly {
  readonly sheetName: string
  readonly range: string
}[] {
  const bySheet = new Map<string, number>()
  for (const definition of ORC_CONTRACT_SOURCE_DEFINITIONS) {
    for (const segment of definition.segments) {
      bySheet.set(
        segment.sheetName,
        Math.max(bySheet.get(segment.sheetName) ?? 0, segment.endRow)
      )
    }
  }
  return [...bySheet.entries()].map(([sheetName, endRow]) => ({
    sheetName,
    range: `'${sheetName.replaceAll("'", "''")}'!A1:Z${endRow}`,
  }))
}
