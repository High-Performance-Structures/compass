import { describe, expect, it } from "vitest"

import { directoryClientIdFor } from "@/lib/sage/client-directory-match"

const ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF"
const entry = { sageRecordId: ID, sageClientNumber: "676", name: "Example Client" }
const numberOnly = { name: "Example Client", sageClientId: null, sageClientNumber: "676" }

describe("directoryClientIdFor", () => {
  it("links a number-only client when Sage's directory has that number under the same name", () => {
    expect(directoryClientIdFor(numberOnly, entry)).toBe(ID.toLowerCase())
    expect(directoryClientIdFor({ ...numberOnly, name: "  example   CLIENT " }, entry)).toBe(ID.toLowerCase())
    expect(directoryClientIdFor({ ...numberOnly, sageClientNumber: " 676 " }, entry)).toBe(ID.toLowerCase())
  })

  it("never links on the number alone", () => {
    expect(directoryClientIdFor({ ...numberOnly, name: "Someone Else" }, entry)).toBeNull()
    expect(directoryClientIdFor({ ...numberOnly, name: " " }, { ...entry, name: " " })).toBeNull()
  })

  it("leaves clients that already have an id, have no number, or are not in the directory", () => {
    expect(directoryClientIdFor({ ...numberOnly, sageClientId: ID }, entry)).toBeNull()
    expect(directoryClientIdFor({ ...numberOnly, sageClientNumber: null }, entry)).toBeNull()
    expect(directoryClientIdFor(numberOnly, undefined)).toBeNull()
    expect(directoryClientIdFor({ ...numberOnly, sageClientNumber: "677" }, entry)).toBeNull()
    expect(directoryClientIdFor(numberOnly, { ...entry, sageRecordId: " " })).toBeNull()
  })
})
