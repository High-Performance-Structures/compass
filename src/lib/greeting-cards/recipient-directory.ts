import type {
  GreetingCardRecipient,
  GreetingCardRecipientType,
} from "@/lib/greeting-cards/workflow"

export type GreetingCardRecipientSource =
  | "customer"
  | "vendor"
  | "vendor_contact"
  | "team"

export type GreetingCardRecipientOption = {
  readonly id: string
  readonly sourceType: GreetingCardRecipientSource
  readonly displayName: string
  readonly companyName: string | null
  readonly recipientType: GreetingCardRecipientType
  readonly recipient: GreetingCardRecipient
  readonly addressStatus: "complete" | "partial" | "missing"
}

type RecipientOptionInput = {
  readonly id: string
  readonly sourceType: GreetingCardRecipientSource
  readonly displayName: string
  readonly companyName: string | null
  readonly email?: string | null
  readonly address: string | null
  readonly recipientType: GreetingCardRecipientType
  readonly personName: boolean
  readonly firstName?: string | null
  readonly lastName?: string | null
}

const STATE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
}

export function buildGreetingCardRecipientOption(
  input: RecipientOptionInput,
): GreetingCardRecipientOption {
  const parsedName = input.personName
    ? splitRecipientName(input.displayName)
    : { firstName: "", lastName: "" }
  const parsedAddress = parseUsMailingAddress(input.address)
  const firstName = input.firstName?.trim() || parsedName.firstName
  const lastName = input.lastName?.trim() || parsedName.lastName

  return {
    id: `${input.sourceType}:${input.id}`,
    sourceType: input.sourceType,
    displayName: input.displayName.trim(),
    companyName: input.companyName?.trim() || null,
    recipientType: input.recipientType,
    recipient: {
      firstName,
      lastName,
      businessName: input.companyName?.trim() || "",
      email: input.email?.trim() || "",
      ...parsedAddress.recipient,
    },
    addressStatus: parsedAddress.status,
  }
}

export function parseUsMailingAddress(address: string | null): {
  readonly recipient: Pick<
    GreetingCardRecipient,
    "address1" | "address2" | "city" | "state" | "postalCode"
  >
  readonly status: "complete" | "partial" | "missing"
} {
  const normalized = address?.replace(/\r\n?/g, "\n").trim() ?? ""
  if (!normalized) return { recipient: emptyAddress(), status: "missing" }

  const parts = normalized
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const finalPart = parts.at(-1) ?? ""
  const cityStateZip = /^(.+?)\s+([A-Za-z]{2}|[A-Za-z ]+)\s+(\d{5}(?:-\d{4})?)$/.exec(
    finalPart,
  )
  const stateZip = /^([A-Za-z]{2}|[A-Za-z ]+)\s+(\d{5}(?:-\d{4})?)$/.exec(
    finalPart,
  )

  let city = ""
  let state = ""
  let postalCode = ""
  let addressParts = parts
  if (cityStateZip) {
    city = cityStateZip[1]?.trim() ?? ""
    state = normalizeState(cityStateZip[2] ?? "")
    postalCode = cityStateZip[3] ?? ""
    addressParts = parts.slice(0, -1)
  } else if (stateZip && parts.length >= 2) {
    city = parts.at(-2) ?? ""
    state = normalizeState(stateZip[1] ?? "")
    postalCode = stateZip[2] ?? ""
    addressParts = parts.slice(0, -2)
  }

  const recipient = {
    address1: addressParts[0] ?? normalized,
    address2: addressParts.slice(1).join(", "),
    city,
    state,
    postalCode,
  }
  const complete = Boolean(
    recipient.address1 &&
      recipient.city &&
      /^[A-Z]{2}$/.test(recipient.state) &&
      /^\d{5}(?:-\d{4})?$/.test(recipient.postalCode),
  )
  return { recipient, status: complete ? "complete" : "partial" }
}

export function splitRecipientName(name: string): {
  readonly firstName: string
  readonly lastName: string
} {
  const normalized = name.trim().replace(/\s+/g, " ")
  if (!normalized) return { firstName: "", lastName: "" }

  const commaParts = normalized.split(",").map((part) => part.trim())
  if (commaParts.length === 2 && commaParts[0] && commaParts[1]) {
    return { firstName: commaParts[1], lastName: commaParts[0] }
  }

  const parts = normalized.split(" ")
  if (parts.length === 1) return { firstName: parts[0] ?? "", lastName: "" }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "",
  }
}

function emptyAddress(): Pick<
  GreetingCardRecipient,
  "address1" | "address2" | "city" | "state" | "postalCode"
> {
  return { address1: "", address2: "", city: "", state: "", postalCode: "" }
}

function normalizeState(value: string): string {
  const trimmed = value.trim()
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase()
  return STATE_ABBREVIATIONS[trimmed.toLowerCase()] ?? ""
}
