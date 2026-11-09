import { describe, expect, it } from "vitest"

import { EMPTY_LINK_PREVIEW, fetchLinkPreview, normalizeSupplierUrl, parseLinkPreview } from "@/lib/selections/link-preview"

const PRODUCT_PAGE = `<!doctype html><html><head>
  <title>Fallback title</title>
  <meta property="og:title" content="Delta Trinsic Faucet &amp; Drain">
  <meta property="og:image" content="/images/faucet.jpg">
  <meta property="og:site_name" content="Supplier Store">
  <meta property="product:price:amount" content="1,249.99">
</head><body></body></html>`

describe("parseLinkPreview", () => {
  it("reads og tags, resolves the image and reads the price as cents", () => {
    expect(parseLinkPreview(PRODUCT_PAGE, "https://shop.example.com/p/123")).toEqual({
      title: "Delta Trinsic Faucet & Drain",
      imageUrl: "https://shop.example.com/images/faucet.jpg",
      siteName: "Supplier Store",
      priceCents: 124999,
    })
  })

  it("falls back to <title>, the host name and a JSON-LD offer price", () => {
    const html = `<title> Hex Tile </title><script type="application/ld+json">{"@type":"Product","offers":{"price":"8.49"}}</script>`
    expect(parseLinkPreview(html, "https://www.tiles.example.com/hex")).toEqual({
      title: "Hex Tile",
      imageUrl: null,
      siteName: "tiles.example.com",
      priceCents: 849,
    })
  })

  it("ignores non-web image urls", () => {
    const html = `<meta property="og:image" content="javascript:alert(1)">`
    expect(parseLinkPreview(html, "https://a.example.com/").imageUrl).toBeNull()
  })
})

describe("normalizeSupplierUrl", () => {
  it("accepts web addresses and adds https when missing", () => {
    expect(normalizeSupplierUrl("homedepot.com/p/1")).toBe("https://homedepot.com/p/1")
    expect(normalizeSupplierUrl("http://example.com/x")).toBe("http://example.com/x")
  })

  it("rejects other schemes, credentials and private hosts", () => {
    expect(normalizeSupplierUrl("javascript:alert(1)")).toBeNull()
    expect(normalizeSupplierUrl("ftp://example.com")).toBeNull()
    expect(normalizeSupplierUrl("https://user:pw@example.com")).toBeNull()
    expect(normalizeSupplierUrl("http://localhost:3000")).toBeNull()
    expect(normalizeSupplierUrl("http://192.168.1.10/admin")).toBeNull()
    expect(normalizeSupplierUrl("http://169.254.169.254/latest")).toBeNull()
    expect(normalizeSupplierUrl("   ")).toBeNull()
  })
})

describe("fetchLinkPreview", () => {
  it("parses an html response", async () => {
    const fetcher: typeof fetch = async () => new Response(PRODUCT_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } })
    const preview = await fetchLinkPreview("https://shop.example.com/p/123", { fetcher })
    expect(preview.title).toBe("Delta Trinsic Faucet & Drain")
  })

  it("returns an empty preview on errors, non-html and failed requests", async () => {
    const failing: typeof fetch = async () => {
      throw new Error("timeout")
    }
    const pdf: typeof fetch = async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })
    const missing: typeof fetch = async () => new Response("no", { status: 404 })
    expect(await fetchLinkPreview("https://a.example.com", { fetcher: failing })).toEqual(EMPTY_LINK_PREVIEW)
    expect(await fetchLinkPreview("https://a.example.com", { fetcher: pdf })).toEqual(EMPTY_LINK_PREVIEW)
    expect(await fetchLinkPreview("https://a.example.com", { fetcher: missing })).toEqual(EMPTY_LINK_PREVIEW)
  })
})
