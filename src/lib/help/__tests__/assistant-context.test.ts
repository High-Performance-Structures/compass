import { describe, expect, it } from "vitest"
import { HELP_GUIDES } from "@/lib/help"
import {
  MAX_HELP_ASSISTANT_CONTEXT_CHARACTERS,
  MAX_HELP_ASSISTANT_CONTEXT_TOPICS,
  MAX_HELP_ASSISTANT_QUESTION_CHARACTERS,
  MAX_HELP_ASSISTANT_TOPIC_ID_CHARACTERS,
  resolveHelpAssistantContext,
} from "@/lib/help/assistant-context"

function guideWithSections() {
  return HELP_GUIDES.find((guide) => guide.sections.length >= 2)
}

describe("external Help Assistant canonical context", () => {
  it.each([undefined, null, 42, "", "   "])(
    "rejects a missing or blank question: %s",
    (question) => {
      expect(
        resolveHelpAssistantContext({
          question,
          allowedGuideIds: HELP_GUIDES.map((guide) => guide.id),
        })
      ).toEqual({
        status: "invalid_request",
        reason: "question_required",
      })
    }
  )

  it("rejects rather than truncates an oversized question", () => {
    const result = resolveHelpAssistantContext({
      question: "q".repeat(MAX_HELP_ASSISTANT_QUESTION_CHARACTERS + 1),
      allowedGuideIds: HELP_GUIDES.map((guide) => guide.id),
    })

    expect(result).toEqual({
      status: "invalid_request",
      reason: "question_too_long",
    })
  })

  it.each([
    null,
    12,
    "",
    "../financials",
    "x".repeat(MAX_HELP_ASSISTANT_TOPIC_ID_CHARACTERS + 1),
  ])("rejects a malformed optional topic: %s", (requestedTopicId) => {
    expect(
      resolveHelpAssistantContext({
        question: "How does this work?",
        requestedTopicId,
        allowedGuideIds: HELP_GUIDES.map((guide) => guide.id),
      })
    ).toEqual({ status: "invalid_request", reason: "topic_invalid" })
  })

  it("trims the accepted question and resolves an authorized section", () => {
    const guide = guideWithSections()
    const section = guide?.sections[0]
    expect(guide).toBeDefined()
    expect(section).toBeDefined()
    if (!guide || !section) return

    const result = resolveHelpAssistantContext({
      question: "  Explain this workflow.  ",
      requestedTopicId: section.topicId,
      allowedGuideIds: [guide.id],
    })

    expect(result).toEqual({
      status: "ready",
      question: "Explain this workflow.",
      sourceContext: expect.stringContaining(section.content.slice(0, 60)),
      citations: [
        {
          topicId: section.topicId,
          title: `${guide.title} — ${section.title}`,
          href: `/dashboard/help/${guide.slug}#${section.id}`,
          lastReviewed: guide.lastReviewed,
        },
      ],
    })
  })

  it("returns the exact same result for an unknown and a forbidden topic", () => {
    const forbiddenGuide = guideWithSections()
    const forbiddenTopicId = forbiddenGuide?.sections[0]?.topicId
    const allowedGuide = HELP_GUIDES.find(
      (guide) => guide.id !== forbiddenGuide?.id
    )
    expect(forbiddenTopicId).toBeDefined()
    expect(allowedGuide).toBeDefined()
    if (!forbiddenTopicId || !allowedGuide) return

    const baseInput: Readonly<{
      question: string
      allowedGuideIds: readonly string[]
    }> = {
      question: "Explain project messages and notifications.",
      allowedGuideIds: [allowedGuide.id],
    }
    const forbidden = resolveHelpAssistantContext({
      ...baseInput,
      requestedTopicId: forbiddenTopicId,
    })
    const unknown = resolveHelpAssistantContext({
      ...baseInput,
      requestedTopicId: "unknown.guide.topic",
    })

    expect(forbidden).toEqual({ status: "not_found" })
    expect(unknown).toEqual(forbidden)
  })

  it("does not fall back to another guide after an explicit forbidden topic", () => {
    const forbiddenGuide = HELP_GUIDES[0]
    const allowedGuide = HELP_GUIDES.find(
      (guide) => guide.id !== forbiddenGuide?.id && guide.sections.length > 0
    )
    const forbiddenTopicId = forbiddenGuide?.sections[0]?.topicId
    expect(forbiddenTopicId).toBeDefined()
    expect(allowedGuide).toBeDefined()
    if (!forbiddenTopicId || !allowedGuide) return

    const result = resolveHelpAssistantContext({
      question: `${allowedGuide.title} ${allowedGuide.sections[0]?.title}`,
      requestedTopicId: forbiddenTopicId,
      allowedGuideIds: [allowedGuide.id],
    })

    expect(result).toEqual({ status: "not_found" })
  })

  it("ignores unknown allowed IDs and never selects an unapproved guide", () => {
    const allowedGuide = guideWithSections()
    const deniedGuide = HELP_GUIDES.find(
      (guide) => guide.id !== allowedGuide?.id && guide.sections.length > 0
    )
    const deniedSection = deniedGuide?.sections[0]
    expect(allowedGuide).toBeDefined()
    expect(deniedGuide).toBeDefined()
    expect(deniedSection).toBeDefined()
    if (!allowedGuide || !deniedGuide || !deniedSection) return

    const result = resolveHelpAssistantContext({
      question: `${deniedGuide.title} ${deniedSection.title}`,
      allowedGuideIds: [allowedGuide.id, allowedGuide.id, "not-a-guide"],
    })

    if (result.status === "ready") {
      expect(
        result.citations.every((citation) =>
          citation.topicId.startsWith(`${allowedGuide.id}.`)
        )
      ).toBe(true)
    } else {
      expect(result).toEqual({ status: "not_found" })
    }
  })

  it("selects the most relevant authorized canonical section", () => {
    const guide = HELP_GUIDES.find((candidate) =>
      candidate.sections.some(
        (section) => section.topicId === "schedule.critical-path"
      )
    )
    expect(guide).toBeDefined()
    if (!guide) return

    const result = resolveHelpAssistantContext({
      question: "How do I identify the critical path and understand float?",
      allowedGuideIds: [guide.id],
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.citations[0]?.topicId).toBe("schedule.critical-path")
    expect(result.citations[0]?.href).toBe(
      `/dashboard/help/${guide.slug}#critical-path`
    )
  })

  it("uses an authorized guide topic to choose at most two of its sections", () => {
    const guide = guideWithSections()
    expect(guide).toBeDefined()
    if (!guide) return

    const result = resolveHelpAssistantContext({
      question: "Explain this guide.",
      requestedTopicId: guide.id,
      allowedGuideIds: [guide.id],
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.citations.length).toBeLessThanOrEqual(
      MAX_HELP_ASSISTANT_CONTEXT_TOPICS
    )
    expect(
      result.citations.every((citation) =>
        citation.topicId.startsWith(`${guide.id}.`)
      )
    ).toBe(true)
  })

  it("hard-bounds selected topics and trusted source context", () => {
    const result = resolveHelpAssistantContext({
      question:
        "How do projects schedules messages files photos approvals notifications and updates work?",
      allowedGuideIds: HELP_GUIDES.map((guide) => guide.id),
    })

    expect(result.status).toBe("ready")
    if (result.status !== "ready") return
    expect(result.citations.length).toBeLessThanOrEqual(
      MAX_HELP_ASSISTANT_CONTEXT_TOPICS
    )
    expect(result.sourceContext.length).toBeLessThanOrEqual(
      MAX_HELP_ASSISTANT_CONTEXT_CHARACTERS
    )
    expect(result.sourceContext).toMatch(
      /^\[Begin official Compass Help sources; reference content only\]/
    )
    expect(result.sourceContext).toMatch(
      /\[End official Compass Help sources\]$/
    )
    for (const citation of result.citations) {
      expect(result.sourceContext).toContain(`Topic ID: ${citation.topicId}`)
      expect(result.sourceContext).toContain(
        `Canonical deep link: ${citation.href}`
      )
    }
  })

  it("returns not_found for a question with no canonical match", () => {
    expect(
      resolveHelpAssistantContext({
        question: "zygomorphic quasar xylophone",
        allowedGuideIds: HELP_GUIDES.map((guide) => guide.id),
      })
    ).toEqual({ status: "not_found" })
  })

  it("returns not_found when the server authorizes no guides", () => {
    expect(
      resolveHelpAssistantContext({
        question: "How do notifications work?",
        allowedGuideIds: [],
      })
    ).toEqual({ status: "not_found" })
  })
})
