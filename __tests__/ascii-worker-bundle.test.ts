import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { asciiEscapeJavaScript } from "../scripts/ascii-worker-bundle.mjs"

function run(source: string): unknown {
  return new Function(`return (${source})`)()
}

describe("asciiEscapeJavaScript", () => {
  it("escapes strings and regular expressions without changing their meaning", () => {
    const source = String.raw`[ "a — b", /[–—]/.test("x – y"), "x\—y", /^[\s\-–—]+/u.exec("— z")[0], "\\—" ]`
    const { source: escaped, escaped: count } = asciiEscapeJavaScript(source)
    expect(escaped).toMatch(/^[\x00-\x7f]*$/)
    expect(count).toBe(9)
    expect(run(escaped)).toEqual(run(source))
  })

  it("escapes comments and leaves ASCII-only code untouched", () => {
    expect(asciiEscapeJavaScript("1 /* naïve — note */ + 2").source).toBe("1 /* na\\u00efve \\u2014 note */ + 2")
    const ascii = "const a = 'plain'"
    expect(asciiEscapeJavaScript(ascii)).toEqual({ source: ascii, escaped: 0 })
  })

  it("refuses text it cannot escape safely", () => {
    expect(() => asciiEscapeJavaScript("String.raw`a — b`")).toThrow(/template/)
    expect(() => asciiEscapeJavaScript("const café = 1")).toThrow(/name/)
  })

  it("runs between the OpenNext build and every upload", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts
    for (const name of ["deploy:direct", "upload", "preview"]) {
      expect(scripts[name]).toMatch(/opennextjs-cloudflare build && bun scripts\/ascii-worker-bundle\.mjs && opennextjs-cloudflare /)
    }
    // `deploy` uploads through the update-window script (it runs
    // `opennextjs-cloudflare upload` itself).
    expect(scripts.deploy).toMatch(/opennextjs-cloudflare build && bun scripts\/ascii-worker-bundle\.mjs && node scripts\/deploy-with-update-window\.mjs$/)
  })
})
