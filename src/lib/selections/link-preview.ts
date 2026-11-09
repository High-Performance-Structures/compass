/**
 * Supplier product link previews for selection choices: reads og:title,
 * og:image, the site name and a price from the product page, server-side,
 * with a timeout. Any failure returns an empty preview, so the caller still
 * saves a plain link. `parseLinkPreview` is pure and tested on its own.
 */
import { toCents } from "@/lib/format"

export type LinkPreview = {
  readonly title: string | null
  readonly imageUrl: string | null
  readonly siteName: string | null
  readonly priceCents: number | null
}

export const EMPTY_LINK_PREVIEW: LinkPreview = { title: null, imageUrl: null, siteName: null, priceCents: null }

const MAX_HTML_BYTES = 600_000
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * A link a person may save: http(s) only, no credentials, and not a local or
 * private-network host. Returns the normalized URL or null.
 */
export function normalizeSupplierUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (url.username || url.password) return null
  if (isPrivateHost(url.hostname)) return null
  return url.toString()
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true
  if (!host.includes(".") && !host.includes(":")) return true
  if (host.includes(":")) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")
  const parts = host.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  const [a = 0, b = 0] = parts
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " }

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z#0-9]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)
  if (!match) return null
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim() || null
}

/** The content of the first <meta> whose property/name/itemprop is one of `keys`. */
function metaContent(tags: readonly string[], keys: readonly string[]): string | null {
  for (const key of keys) {
    for (const tag of tags) {
      const id = attribute(tag, "property") ?? attribute(tag, "name") ?? attribute(tag, "itemprop")
      if (id?.toLowerCase() === key) {
        const content = attribute(tag, "content")
        if (content) return content
      }
    }
  }
  return null
}

/** A price from JSON-LD Product offers, when the page has one. */
function jsonLdPrice(html: string): string | null {
  const scripts = html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)
  for (const script of scripts) {
    const match = /"price"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)"?/.exec(script[1] ?? "")
    if (match?.[1]) return match[1]
  }
  return null
}

function absoluteUrl(value: string | null, base: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, base)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

/** Reads the preview card fields from a product page's HTML. */
export function parseLinkPreview(html: string, pageUrl: string): LinkPreview {
  const head = html.slice(0, MAX_HTML_BYTES)
  const tags = head.match(/<meta\b[^>]*>/gi) ?? []
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  const title = metaContent(tags, ["og:title", "twitter:title"]) ?? (titleTag ? decodeEntities(titleTag).replace(/\s+/g, " ").trim() || null : null)
  const image = metaContent(tags, ["og:image:secure_url", "og:image", "twitter:image"])
  const price = metaContent(tags, ["product:price:amount", "og:price:amount", "price"]) ?? jsonLdPrice(head)
  const cents = price ? toCents(price) : null
  let siteName = metaContent(tags, ["og:site_name", "application-name"])
  if (!siteName) {
    try {
      siteName = new URL(pageUrl).hostname.replace(/^www\./, "")
    } catch {
      siteName = null
    }
  }
  return {
    title: title ? title.slice(0, 300) : null,
    imageUrl: absoluteUrl(image, pageUrl),
    siteName,
    priceCents: cents !== null && cents > 0 ? cents : null,
  }
}

/** Fetches and parses a product page; never throws. */
export async function fetchLinkPreview(
  url: string,
  options: { readonly timeoutMs?: number; readonly fetcher?: typeof fetch } = {},
): Promise<LinkPreview> {
  const fetcher = options.fetcher ?? fetch
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; CompassLinkPreview/1.0)" },
    })
    if (!response.ok) return EMPTY_LINK_PREVIEW
    const type = response.headers.get("content-type") ?? ""
    if (type && !type.includes("html")) return EMPTY_LINK_PREVIEW
    // A redirect to a private host is not read.
    if (response.url && !normalizeSupplierUrl(response.url)) return EMPTY_LINK_PREVIEW
    const html = (await response.text()).slice(0, MAX_HTML_BYTES)
    return parseLinkPreview(html, response.url || url)
  } catch {
    return EMPTY_LINK_PREVIEW
  }
}
