import { describe, expect, it } from "vitest"
import { contactNotesDisplay } from "@/lib/contact-notes"

describe("contactNotesDisplay", () => {
  it("turns imported Buildertrend metadata into a link and hides the JSON", () => {
    expect(contactNotesDisplay('{"buildertrendHref":"https://buildertrend.net/app/contacts/123"}')).toEqual({
      text: null,
      buildertrendHref: "https://buildertrend.net/app/contacts/123",
    })
  })

  it("keeps ordinary notes", () => {
    expect(contactNotesDisplay("Prefers texts after 3 pm")).toEqual({ text: "Prefers texts after 3 pm", buildertrendHref: null })
  })

  it("refuses links that are not secure Buildertrend addresses", () => {
    expect(contactNotesDisplay('{"buildertrendHref":"javascript:alert(1)"}').buildertrendHref).toBeNull()
    expect(contactNotesDisplay('{"buildertrendHref":"https://buildertrend.net.evil.example/x"}').buildertrendHref).toBeNull()
    expect(contactNotesDisplay('{"buildertrendHref":"http://buildertrend.net/x"}').buildertrendHref).toBeNull()
  })

  it("keeps note text stored alongside the metadata", () => {
    expect(contactNotesDisplay('{"buildertrendHref":"https://app.buildertrend.com/c/1","notes":"Gate code 4411"}')).toEqual({
      text: "Gate code 4411",
      buildertrendHref: "https://app.buildertrend.com/c/1",
    })
  })
})
