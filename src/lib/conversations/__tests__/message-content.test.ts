import { describe, expect, it } from "vitest"

import { normalizeConversationMentions } from "../message-content"

describe("normalizeConversationMentions", () => {
  it("renders TipTap mention spans as their visible labels", () => {
    expect(
      normalizeConversationMentions(
        '<span class="mention" data-type="mention" data-id="user-1" ' +
          'data-label="Wes Jones">@Wes Jones</span> please refresh Compass.'
      )
    ).toBe("@Wes Jones please refresh Compass.")
  })

  it("supports sanitized attribute ordering and quotes", () => {
    expect(
      normalizeConversationMentions(
        "<span data-id='user-2' data-type='mention' class='mention'>" +
          "@Martine &amp; team</span>"
      )
    ).toBe("@Martine & team")
  })

  it("does not reinterpret unrelated HTML as a mention", () => {
    const content = "<span class=\"note\">Keep this literal</span>"
    expect(normalizeConversationMentions(content)).toBe(content)
  })
})
