/*
 * Did an inbound email really come from the domain in its From address?
 * Gmail checks SPF, DKIM and DMARC when it receives a message and stamps its
 * verdict in an Authentication-Results header at the top of the headers.
 * Anyone can write their own Authentication-Results lower down, so only the
 * topmost one, and only when Gmail wrote it, is read. Pure and client-safe.
 */

/** pass: Gmail confirmed the From domain. fail: Gmail checked and it didn't. none: no verdict from Gmail. */
export type SenderAuthentication = "pass" | "fail" | "none"

const SENDER_AUTHENTICATIONS: readonly SenderAuthentication[] = ["pass", "fail", "none"]

type Header = { readonly name: string; readonly value: string }

// Gmail's receiving servers name themselves mx.google.com in the verdict.
const GMAIL_AUTHSERV_ID = "mx.google.com"

function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@")
  const domain = (at >= 0 ? address.slice(at + 1) : address).trim().toLowerCase().replace(/[>;]+$/, "")
  return domain.length > 0 ? domain : null
}

/** Relaxed alignment: the same domain, or one is a subdomain of the other. */
function aligned(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/**
 * Comments `(…)`, nested or not, and quoted strings become spaces before the
 * value is split on `;`: Gmail's comments echo sender-controlled text (the
 * envelope sender), which could otherwise smuggle in a fake `dmarc=pass`.
 */
function withoutCommentsOrQuotes(value: string): string {
  let out = ""
  let depth = 0
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "\\") { index += 1; out += " "; continue }
    if (quoted) { if (char === '"') quoted = false; out += " "; continue }
    if (char === "(") { depth += 1; out += " "; continue }
    if (char === ")" && depth > 0) { depth -= 1; out += " "; continue }
    if (depth > 0) { out += " "; continue }
    if (char === '"') { quoted = true; out += " "; continue }
    out += char
  }
  return out
}

/** One method's result and its properties, e.g. `dkim=pass header.i=@example.com`. */
function methodResults(value: string): readonly { readonly method: string; readonly result: string; readonly props: ReadonlyMap<string, string> }[] {
  return withoutCommentsOrQuotes(value).split(";").slice(1).map((part) => {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    const [method = "", result = ""] = (tokens[0] ?? "").toLowerCase().split("=")
    const props = new Map<string, string>()
    for (const token of tokens.slice(1)) {
      const equals = token.indexOf("=")
      if (equals > 0) props.set(token.slice(0, equals).toLowerCase(), token.slice(equals + 1))
    }
    return { method, result, props }
  })
}

/**
 * Gmail's verdict for this message. `headers` are in the order Gmail returns
 * them, newest (topmost) first.
 */
export function senderAuthenticationFromHeaders(headers: readonly Header[], fromAddress: string): SenderAuthentication {
  const topmost = headers.find((header) => header.name.toLowerCase() === "authentication-results")
  if (!topmost) return "none"
  if (withoutCommentsOrQuotes(topmost.value).split(";")[0]?.trim().toLowerCase() !== GMAIL_AUTHSERV_ID) return "none"
  const fromDomain = domainOf(fromAddress)
  const passed = methodResults(topmost.value).some(({ method, result, props }) => {
    if (result !== "pass") return false
    // DMARC's own From domain must be the one Compass read, as DKIM's and SPF's must.
    if (method === "dmarc") return aligned(domainOf(props.get("header.from") ?? ""), fromDomain)
    if (method === "dkim") return aligned(domainOf(props.get("header.d") ?? props.get("header.i") ?? ""), fromDomain)
    if (method === "spf") return aligned(domainOf(props.get("smtp.mailfrom") ?? ""), fromDomain)
    return false
  })
  return passed ? "pass" : "fail"
}

export function isSenderAuthentication(value: unknown): value is SenderAuthentication {
  return SENDER_AUTHENTICATIONS.some((authentication) => authentication === value)
}
