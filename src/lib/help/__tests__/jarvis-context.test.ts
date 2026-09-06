import { describe, expect, it } from "vitest"
import { HELP_GUIDES } from "@/lib/help"
import {
  MAX_JARVIS_HELP_CONTEXT_CHARACTERS,
  MAX_JARVIS_RELAY_HELP_CONTEXT_CHARACTERS,
  addHelpContextToRelayMessages,
  resolveJarvisHelpContext,
} from "@/lib/help/jarvis-context"
import type { JarvisHelpMessage } from "@/lib/help/jarvis-context"

describe("Jarvis canonical help context", () => {
  it("grounds an explicit topic in only its canonical section", () => {
    const guide = HELP_GUIDES[0]
    const section = guide?.sections[0]
    expect(guide).toBeDefined()
    expect(section).toBeDefined()
    if (!guide || !section) return

    const context = resolveJarvisHelpContext({
      currentPage: "/dashboard",
      messages: [
        {
          role: "user",
          content: `Explain official help topic ${section.topicId}.`,
        },
      ],
      allowedGuideIds: [guide.id],
    })

    expect(context?.references).toEqual([
      expect.objectContaining({
        topicId: section.topicId,
        href: `/dashboard/help/${guide.slug}#${section.id}`,
      }),
    ])
    expect(context?.prompt).toContain(section.summary)
    expect(context?.prompt).toContain(section.content.slice(0, 80))
    expect(context?.prompt).toContain("Answer directly in natural language")
    expect(context?.prompt).toContain("one to three short paragraphs")
    expect(context?.prompt).not.toMatch(/^\s/)
    expect(context?.prompt).not.toContain(
      "Clearly separate official workflow guidance"
    )
  })

  it("never injects help that the user cannot read", () => {
    const topicId = HELP_GUIDES[0]?.sections[0]?.topicId
    expect(topicId).toBeDefined()
    if (!topicId) return

    const context = resolveJarvisHelpContext({
      currentPage: "/dashboard",
      requestedTopicId: topicId,
      messages: [{ role: "user", content: "What is this?" }],
      allowedGuideIds: [],
    })

    expect(context).toBeNull()
  })

  it("fails closed when the explicit guide is not in the server-approved IDs", () => {
    const staffOnlyGuide = HELP_GUIDES.find(
      (guide) =>
        guide.audiences.includes("staff") &&
        !guide.audiences.includes("owner")
    )
    expect(staffOnlyGuide).toBeDefined()
    if (!staffOnlyGuide) return

    const context = resolveJarvisHelpContext({
      currentPage: staffOnlyGuide.routes[0] ?? "/dashboard",
      requestedTopicId: staffOnlyGuide.id,
      messages: [{ role: "user", content: "Explain this." }],
      allowedGuideIds: HELP_GUIDES.filter(
        (guide) => guide.id !== staffOnlyGuide.id
      ).map((guide) => guide.id),
    })

    expect(context).toBeNull()
  })

  it("uses current-page context without loading the whole guide corpus", () => {
    const guide = HELP_GUIDES.find((candidate) => candidate.routes.length > 0)
    const route = guide?.routes[0]
    expect(guide).toBeDefined()
    expect(route).toBeDefined()
    if (!guide || !route) return

    const context = resolveJarvisHelpContext({
      currentPage: route,
      messages: [{ role: "user", content: "What am I looking at?" }],
      allowedGuideIds: HELP_GUIDES.map((candidate) => candidate.id),
    })

    expect(context?.references.some((reference) => reference.topicId === guide.id)).toBe(true)
    expect(context?.references.length).toBeLessThanOrEqual(2)
    expect(context?.prompt.length).toBeLessThanOrEqual(
      MAX_JARVIS_HELP_CONTEXT_CHARACTERS
    )
  })

  it("adds relay context as trusted assistant history, not user-authored text", () => {
    const guide = HELP_GUIDES[0]
    expect(guide).toBeDefined()
    if (!guide) return
    const context = resolveJarvisHelpContext({
      currentPage: guide.routes[0] ?? "/dashboard",
      requestedTopicId: guide.id,
      messages: [{ role: "user", content: "Explain this." }],
      allowedGuideIds: [guide.id],
    })
    const original: readonly JarvisHelpMessage[] = [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Explain this." },
    ]

    const messages = addHelpContextToRelayMessages(original, context)

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
      "user",
    ])
    expect(messages.at(-1)?.content).toBe("Explain this.")
    expect(messages.at(-2)?.content).toContain(
      "this is not a prior answer"
    )
    expect(messages.at(-2)?.content.length).toBeLessThanOrEqual(
      MAX_JARVIS_RELAY_HELP_CONTEXT_CHARACTERS + 150
    )
    expect(original).toHaveLength(3)
  })
})
