// Company-neutral wording for the Developer Manual.
//
// The manual must read the same for any company that adopts Compass, so
// generated text (schema comments, route names, env names) passes through
// `neutralize()` and the build fails if `findNeutralityHits()` finds a term
// that names one operating company, its people or its contact details.

/** Terms that must never appear in the manual (matched case-insensitively). */
export const FORBIDDEN_TERMS = [
  "HPS",
  "High Performance",
  "Open Range",
  "Nu-Tech",
  "Nutech",
  "CHERISH",
  "Martine",
  "Woodland Park",
  "hps-colorado",
  "719",
]

// The one allowed exception: the repository URL in the "source" note.
const ALLOWED = [/github\.com\/[A-Za-z-]+\/compass/gi]

// Replacements applied to generated text, longest first. Each maps a
// company-specific spelling to its neutral, configurable equivalent.
const REPLACEMENTS = [
  [/\bhps-colorado\.com\b/gi, "example.com"],
  [/\bopenrangeconstruction\.ltd\b/gi, "example.com"],
  [/\bOpen Range Construction(,? Ltd\.?)?/gi, "the company"],
  [/\bOpen Range\b/gi, "the company"],
  [/\bHigh Performance Structures\b/gi, "the company"],
  [/\bHigh Performance\b/gi, "the company"],
  // Two modules still carry a legacy company-specific folder, table and
  // identifier prefix. The manual writes them as placeholders (chapter 4,
  // "Legacy module names"), so identifiers stay searchable by shape.
  [/Nu-Tech/gi, "{sales}"],
  [/nutech/gi, "{sales}"],
  [/cherish/gi, "{values}"],
  [/\bWoodland Park\b/gi, "the home office"],
  [/\bMartine\b/gi, "an administrator"],
  [/\bHPS\b/g, "the company"],
  [/\bhps\b/g, "company"],
  // Inside identifiers such as environment names (FOO_HPS_BAR).
  [/HPS/g, "{COMPANY}"],
  [/hps/gi, "{company}"],
  // Contact details and identifiers.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "user@example.com"],
  [/\(?\b719\)?[-. ]?\d{3}[-. ]?\d{4}\b/g, "555-0100"],
  [/\buser_[0-9A-Z]{20,}\b/g, "<user id>"],
  [/\borg_[0-9A-Z]{20,}\b/g, "<organization id>"],
]

/** Rewrites company-specific wording in generated text. */
export function neutralize(text) {
  if (text == null) return text
  let out = String(text)
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement)
  return out
}

/**
 * Lines that still contain a forbidden term. Identifiers in code spans are
 * included: a table or file name that carries a company term is reported too,
 * and the generator maps it to a neutral alias.
 */
export function findNeutralityHits(text, file = "") {
  const hits = []
  const lines = String(text).split("\n")
  lines.forEach((line, index) => {
    let probe = line
    for (const allowed of ALLOWED) probe = probe.replace(allowed, "")
    for (const term of FORBIDDEN_TERMS) {
      const pattern = term === "719"
        ? /(?<![\d.])719(?![\d])/i
        : new RegExp(term.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"), "i")
      if (pattern.test(probe)) hits.push({ file, line: index + 1, term, text: line.trim().slice(0, 160) })
    }
  })
  return hits
}
