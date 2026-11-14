import { describe, expect, it } from "vitest"

import { extractMentions } from "../composer-mentions"

describe("extractMentions", () => {
  it("reads every mention in a composed message, in order", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [
          { type: "text", text: "Hi " },
          { type: "mention", attrs: { id: "user-1", label: "Deb" } },
          { type: "mention", attrs: { id: "channel" } },
        ] },
        { type: "paragraph", content: [
          { type: "mention", attrs: { id: "here" } },
          { type: "mention", attrs: { id: "compass-agent" } },
          { type: "mention", attrs: {} },
        ] },
      ],
    }
    expect(extractMentions(doc)).toEqual([
      { mentionType: "user", targetId: "user-1" },
      { mentionType: "channel", targetId: null },
      { mentionType: "here", targetId: null },
      { mentionType: "agent", targetId: "compass-agent" },
    ])
  })
})
