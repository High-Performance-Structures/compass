import { describe, expect, it } from "vitest"
import { inboundProjectMessageRecipients, type InboundMessagePerson } from "../project-message-mentions"

const staff: readonly InboundMessagePerson[] = [
  { id: "a", name: "Alex Stone", firstName: "Alex", lastName: "Stone", email: "alex.stone@example.test", assigned: true, inApp: true },
  { id: "b", name: "Morgan Reed", firstName: "Morgan", lastName: "Reed", email: "morgan@example.test", assigned: false, inApp: true },
]

describe("incoming project message @names", () => {
  it.each(["@Alex", '@"Alex Stone"', "@alex.stone", "@ALEX."])("resolves %s", (token) => {
    expect(inboundProjectMessageRecipients(`[MESSAGE] ${token} please check`, staff)?.map((p) => p.id)).toEqual(["a"])
  })
  it("deduplicates mentions across the subject and body", () => {
    expect(inboundProjectMessageRecipients("@Alex\n@Alex @Morgan", staff)?.map((p) => p.id)).toEqual(["a", "b"])
  })
  it("routes unmentioned messages to assigned staff, ignoring ordinary email addresses", () => {
    expect(inboundProjectMessageRecipients("Email alex.stone@example.test", staff)?.map((p) => p.id)).toEqual(["a"])
  })
  it("holds unknown or ambiguous names instead of guessing", () => {
    expect(inboundProjectMessageRecipients("@Nobody", staff)).toBeNull()
    const duplicate = { ...staff[1], id: "c", name: "Alex Reed", firstName: "Alex", lastName: "Reed", email: "alex.reed@example.test", assigned: false, inApp: true }
    expect(inboundProjectMessageRecipients("@Alex", [...staff, duplicate])).toBeNull()
    expect(inboundProjectMessageRecipients('@"Alex Stone"', [...staff, duplicate])?.map((p) => p.id)).toEqual(["a"])
  })
  it("holds a malformed quoted mention and a missing default recipient", () => {
    expect(inboundProjectMessageRecipients('@"Alex Stone', staff)).toBeNull()
    expect(inboundProjectMessageRecipients("No mentions", [])).toBeNull()
  })
})
