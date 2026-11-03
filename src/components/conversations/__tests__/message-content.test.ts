/** @vitest-environment jsdom */

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MessageContent } from "../message-content"

function renderedContent(content: string, sourceSystem?: string | null): HTMLDivElement {
  const host = document.createElement("div")
  host.innerHTML = renderToStaticMarkup(
    React.createElement(MessageContent, { id: "message", content, sourceSystem })
  )
  return host
}

describe("conversation message body provenance", () => {
  it("preserves Buildertrend email brackets, separators, spaces and blank lines", () => {
    const source = "From: Sample <person@example.test>\n\n---\n  retained  spacing\n**literal**"
    const host = renderedContent(source, "buildertrend")

    expect(host.textContent).toBe(source)
    expect(host.querySelector("hr, strong, a")).toBeNull()
    expect(host.firstElementChild?.classList.contains("whitespace-pre-wrap")).toBe(true)
  })

  it("treats source HTML and mention-looking text as escaped literal text", () => {
    const source = '<script>local-test</script>\n<span data-type="mention" data-id="sample">@Sample</span>'
    const host = renderedContent(source, "buildertrend")

    expect(host.textContent).toBe(source)
    expect(host.querySelector("script, span")).toBeNull()
  })

  it("keeps authored Compass Markdown and links working", () => {
    const host = renderedContent("**Hello** [reference](https://example.test)", null)

    expect(host.querySelector("strong")?.textContent).toBe("Hello")
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.test")
  })

  it("uses provenance metadata rather than a message ID prefix", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(
      React.createElement(MessageContent, {
        id: "bt-native-looking-id",
        content: "**Authored**",
        sourceSystem: null,
      })
    )

    expect(host.querySelector("strong")?.textContent).toBe("Authored")
  })

  it("retains legacy archive notes outside live source-message rendering", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(
      React.createElement(MessageContent, {
        id: "bt-message-123",
        content: "Legacy excerpt",
      })
    )

    expect(host.textContent).toContain("Buildertrend archive excerpt stored in Compass.")
  })
})
