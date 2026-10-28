import { describe, expect, it } from "vitest"

import { withPickedFiles } from "@/lib/files/picked-files"

const row = (id: string, label = "", url = "") => ({ id, label, url, notes: "" })
const file = (id: string) => ({ id, name: `Sheet ${id}`, url: `https://drive.google.com/file/d/${id}xxxxxxxxxx/view`, kind: "file" as const })

describe("withPickedFiles", () => {
  it("fills the blank row first, then adds rows", () => {
    let n = 0
    const next = withPickedFiles([row("a")], [file("1"), file("2")], () => row(`new-${++n}`))
    expect(next.map((link) => [link.id, link.label])).toEqual([["a", "Sheet 1"], ["new-1", "Sheet 2"]])
  })

  it("skips files already listed and keeps filled rows", () => {
    const listed = row("a", "Plan set", file("1").url)
    const next = withPickedFiles([listed], [file("1")], () => row("never"))
    expect(next).toEqual([listed])
  })
})
