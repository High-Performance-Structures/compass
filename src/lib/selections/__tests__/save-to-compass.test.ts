import { describe, expect, it, vi } from "vitest"

import {
  buildSaveToCompassBookmarklet,
  centsToPriceInput,
  isSaveTargetStatus,
  parseSaveToCompassQuery,
  prefilledChoiceTitle,
  saveTargetSelections,
} from "@/lib/selections/save-to-compass"

describe("buildSaveToCompassBookmarklet", () => {
  it("opens the save popup on the deployment's own origin", () => {
    const bookmarklet = buildSaveToCompassBookmarklet("https://demo.example.com")
    expect(bookmarklet).toBe(
      'javascript:(function(){window.open("https://demo.example.com/save-to-compass"+"?url="+encodeURIComponent(location.href)+"&title="+encodeURIComponent(document.title),"compassSave","width=480,height=680")})()',
    )
  })

  it("keeps only the origin and works over http for local development", () => {
    expect(buildSaveToCompassBookmarklet("http://localhost:3000/dashboard?x=1")).toContain('"http://localhost:3000/save-to-compass"')
  })

  it("refuses origins that are not http(s)", () => {
    expect(buildSaveToCompassBookmarklet("capacitor://localhost")).toBeNull()
    expect(buildSaveToCompassBookmarklet("not a url")).toBeNull()
  })

  it("runs as a script and opens the popup with the page's address and title", () => {
    const bookmarklet = buildSaveToCompassBookmarklet("https://compass.example.com")
    if (!bookmarklet) throw new Error("expected a bookmarklet")
    const open = vi.fn()
    const run = new Function("window", "location", "document", bookmarklet.slice("javascript:".length))
    run({ open }, { href: "https://shop.example.com/p/1?a=b&c=d" }, { title: "Tile & Stone" })
    expect(open).toHaveBeenCalledWith(
      "https://compass.example.com/save-to-compass?url=https%3A%2F%2Fshop.example.com%2Fp%2F1%3Fa%3Db%26c%3Dd&title=Tile%20%26%20Stone",
      "compassSave",
      "width=480,height=680",
    )
  })
})

describe("parseSaveToCompassQuery", () => {
  it("normalizes the address and tidies the title", () => {
    expect(parseSaveToCompassQuery({ url: "https://shop.example.com/p/1", title: "  Hex   Tile \n" })).toEqual({
      ok: true,
      url: "https://shop.example.com/p/1",
      title: "Hex Tile",
    })
  })

  it("takes the first value of repeated parameters and allows no title", () => {
    expect(parseSaveToCompassQuery({ url: ["https://a.example.com/x", "https://b.example.com/y"] })).toEqual({
      ok: true,
      url: "https://a.example.com/x",
      title: "",
    })
  })

  it("rejects a missing address", () => {
    expect(parseSaveToCompassQuery({}).ok).toBe(false)
    expect(parseSaveToCompassQuery({ url: "   " }).ok).toBe(false)
  })

  it("rejects private, local and non-web addresses", () => {
    for (const url of ["http://localhost:3000/x", "http://192.168.1.10/", "javascript:alert(1)", "file:///etc/passwd", "chrome://settings"]) {
      expect(parseSaveToCompassQuery({ url }).ok).toBe(false)
    }
  })

  it("caps a very long title", () => {
    const result = parseSaveToCompassQuery({ url: "https://shop.example.com/p", title: "x".repeat(1000) })
    expect(result.ok && result.title.length).toBe(300)
  })
})

describe("save targets", () => {
  it("accepts open and warranty jobs only", () => {
    expect(isSaveTargetStatus("OPEN")).toBe(true)
    expect(isSaveTargetStatus(" warranty ")).toBe(true)
    expect(isSaveTargetStatus("COMPLETE")).toBe(false)
    expect(isSaveTargetStatus(null)).toBe(false)
  })

  it("lists every selection room by room", () => {
    expect(
      saveTargetSelections([
        { roomName: "Kitchen", selections: [{ id: "s1", name: "Faucet", roomName: "Kitchen", category: "Plumbing" }] },
        { roomName: "Primary Bath", selections: [{ id: "s2", name: "Tile", roomName: "", category: "Tile" }] },
      ]),
    ).toEqual([
      { id: "s1", name: "Faucet", roomName: "Kitchen", category: "Plumbing" },
      { id: "s2", name: "Tile", roomName: "Primary Bath", category: "Tile" },
    ])
  })

  it("prefills the title and price", () => {
    expect(prefilledChoiceTitle("Og Title", "Page title")).toBe("Og Title")
    expect(prefilledChoiceTitle(null, " Page title ")).toBe("Page title")
    expect(centsToPriceInput(124999)).toBe("1249.99")
    expect(centsToPriceInput(null)).toBe("")
  })
})
