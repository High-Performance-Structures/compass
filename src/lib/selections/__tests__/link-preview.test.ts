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

describe("link preview hardening", () => {
  it("rejects IPv4-mapped, IPv4-compatible and translated IPv6 hosts", () => {
    expect(normalizeSupplierUrl("http://[::ffff:127.0.0.1]/")).toBeNull()
    expect(normalizeSupplierUrl("http://[::ffff:10.0.0.1]/admin")).toBeNull()
    expect(normalizeSupplierUrl("http://[0:0:0:0:0:ffff:a9fe:a9fe]/latest")).toBeNull()
    expect(normalizeSupplierUrl("http://[::127.0.0.1]/")).toBeNull()
    expect(normalizeSupplierUrl("http://[64:ff9b::7f00:1]/")).toBeNull()
    expect(normalizeSupplierUrl("http://[2606:4700::1111]/p")).toBe("http://[2606:4700::1111]/p")
  })

  it("follows redirects by hand, checking each hop, at most three", async () => {
    const page = `<meta property="og:title" content="Landed">`
    const calls: string[] = []
    const hops =
      (targets: Readonly<Record<string, string>>): typeof fetch =>
      async (input, init) => {
        const url = String(input)
        calls.push(url)
        expect(init?.redirect).toBe("manual")
        const next = targets[url]
        return next ? new Response(null, { status: 302, headers: { location: next } }) : new Response(page, { headers: { "content-type": "text/html" } })
      }
    const ok = hops({ "https://a.example.com/": "/b", "https://a.example.com/b": "https://c.example.com/" })
    expect((await fetchLinkPreview("https://a.example.com/", { fetcher: ok })).title).toBe("Landed")
    expect(calls).toEqual(["https://a.example.com/", "https://a.example.com/b", "https://c.example.com/"])

    // A hop to a private host is never requested.
    calls.length = 0
    const sneaky = hops({ "https://a.example.com/": "http://169.254.169.254/latest", "https://b.example.com/": "http://[::ffff:7f00:1]/" })
    expect(await fetchLinkPreview("https://a.example.com/", { fetcher: sneaky })).toEqual(EMPTY_LINK_PREVIEW)
    expect(await fetchLinkPreview("https://b.example.com/", { fetcher: sneaky })).toEqual(EMPTY_LINK_PREVIEW)
    expect(calls).toEqual(["https://a.example.com/", "https://b.example.com/"])

    // A fourth redirect is one too many.
    calls.length = 0
    const loop = hops({ "https://a.example.com/1": "/2", "https://a.example.com/2": "/3", "https://a.example.com/3": "/4", "https://a.example.com/4": "/5" })
    expect(await fetchLinkPreview("https://a.example.com/1", { fetcher: loop })).toEqual(EMPTY_LINK_PREVIEW)
    expect(calls).toHaveLength(4)
  })

  it("reads at most the byte cap of a page, without buffering the rest", async () => {
    let pulled = 0
    const chunk = new TextEncoder().encode(`<meta property="og:title" content="Big">${" ".repeat(100_000)}`)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 100) controller.close()
        else controller.enqueue(chunk)
      },
    })
    const fetcher: typeof fetch = async () => new Response(body, { headers: { "content-type": "text/html" } })
    expect((await fetchLinkPreview("https://big.example.com/", { fetcher })).title).toBe("Big")
    // About 600 KB of a 10 MB page: the stream stopped after about seven chunks.
    expect(pulled).toBeLessThan(12)
  })
})
