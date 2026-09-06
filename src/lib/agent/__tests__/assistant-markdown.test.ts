import { describe, expect, it } from "vitest"

import { normalizeAssistantMarkdown } from "@/lib/agent/assistant-markdown"

describe("assistant Markdown normalization", () => {
  it("collapses whitespace-only and encoded-space paragraphs", () => {
    expect(
      normalizeAssistantMarkdown(
        "First step.\n \n\n&#x20;\n\n\nSecond step.  \n"
      )
    ).toBe("First step.\n\nSecond step.")
  })

  it("preserves ordinary paragraphs and list structure", () => {
    const markdown = "Start here.\n\n- One\n- Two\n\nFinish here."

    expect(normalizeAssistantMarkdown(markdown)).toBe(markdown)
  })

  it("preserves intentional blank lines inside fenced code", () => {
    const markdown = "Before\n\n```text\nline one\n\n\nline two\n```\n\nAfter"

    expect(normalizeAssistantMarkdown(markdown)).toBe(markdown)
  })

  it("does not close a longer fence when its content contains a shorter fence", () => {
    const markdown = [
      "````markdown",
      "outer",
      "```",
      "",
      "",
      "inner example",
      "````",
      "",
      "",
      "after",
    ].join("\n")

    expect(normalizeAssistantMarkdown(markdown)).toBe(
      [
        "````markdown",
        "outer",
        "```",
        "",
        "",
        "inner example",
        "````",
        "",
        "after",
      ].join("\n")
    )
  })
})
