export type ContractPacketSigner = {
  readonly contactId: string | null
  readonly name: string
  readonly title: string
  readonly email: string
  readonly initials: string
}

export type ContractPacketScheduleItem = {
  readonly code: string
  readonly title: string
  readonly documentDate: string | null
  readonly revision: string | null
  readonly inclusionMode: string
  readonly signingStage: string
}

export type ContractPacketTokenValues = Readonly<Record<string, string>>

const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const

function underThousand(value: number): string {
  const hundreds = Math.floor(value / 100)
  const remainder = value % 100
  const words: string[] = []
  if (hundreds > 0) words.push(`${SMALL_NUMBERS[hundreds]} hundred`)
  if (remainder < 20) {
    if (remainder > 0) words.push(SMALL_NUMBERS[remainder] ?? "")
  } else {
    const tens = TENS[Math.floor(remainder / 10)] ?? ""
    const ones = remainder % 10
    words.push(ones > 0 ? `${tens}-${SMALL_NUMBERS[ones]}` : tens)
  }
  return words.filter(Boolean).join(" ")
}

export function dollarsInWords(cents: number): string {
  const safeCents = Math.max(0, Math.round(cents))
  const dollars = Math.floor(safeCents / 100)
  const remainder = safeCents % 100
  if (dollars === 0) return `Zero dollars and ${remainder.toString().padStart(2, "0")}/100`
  const groups = [
    { size: 1_000_000_000, label: "billion" },
    { size: 1_000_000, label: "million" },
    { size: 1_000, label: "thousand" },
    { size: 1, label: "" },
  ] as const
  let remaining = dollars
  const words: string[] = []
  for (const group of groups) {
    const amount = Math.floor(remaining / group.size)
    if (amount === 0) continue
    words.push([underThousand(amount), group.label].filter(Boolean).join(" "))
    remaining %= group.size
  }
  const label = dollars === 1 ? "dollar" : "dollars"
  const result = `${words.join(" ")} ${label} and ${remainder.toString().padStart(2, "0")}/100`
  return result.charAt(0).toUpperCase() + result.slice(1)
}

export function signerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 6)
    .toUpperCase()
}

export function parsePacketSigners(value: string): readonly ContractPacketSigner[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): readonly ContractPacketSigner[] => {
      if (!item || typeof item !== "object") return []
      const stringValue = (key: string): string => {
        const candidate = Reflect.get(item, key)
        return typeof candidate === "string" ? candidate.trim() : ""
      }
      const name = stringValue("name")
      if (!name) return []
      const contactId = Reflect.get(item, "contactId")
      return [{
        contactId: typeof contactId === "string" && contactId ? contactId : null,
        name,
        title: stringValue("title"),
        email: stringValue("email"),
        initials: stringValue("initials") || signerInitials(name),
      }]
    })
  } catch {
    return []
  }
}

export function contractDocumentSchedule(
  documents: readonly ContractPacketScheduleItem[]
): string {
  if (documents.length === 0) return "No contract documents selected."
  return [
    "| Document | Title | Date / revision | Treatment |",
    "| --- | --- | --- | --- |",
    ...documents.map((document) => {
      const dateRevision = [document.documentDate, document.revision]
        .filter(Boolean)
        .join(" · ") || "Packet version"
      const treatment = document.inclusionMode === "reference"
        ? "Incorporated by reference"
        : document.signingStage === "closeout"
          ? "Closeout document"
          : "Included"
      return `| ${document.code} | ${document.title} | ${dateRevision} | ${treatment} |`
    }),
  ].join("\n")
}

export function fillContractTokens(
  content: string,
  values: ContractPacketTokenValues
): string {
  return content.replace(/\{\{([a-z0-9_.-]+)\}\}/gi, (token, key: string) => {
    const value = values[key]
    return value === undefined || value === "" ? token : value
  })
}

export function contractPacketCanBeEdited(status: string): boolean {
  return status === "draft" || status === "internal_review"
}
