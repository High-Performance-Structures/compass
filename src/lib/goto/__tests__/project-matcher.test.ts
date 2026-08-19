import { describe, expect, it } from "vitest"

import {
  matchGotoInboundProject,
  type GotoProjectMatchCandidate,
} from "@/lib/goto/project-matcher"

function project(
  input: Partial<GotoProjectMatchCandidate> &
    Pick<GotoProjectMatchCandidate, "id" | "projectNumber">
): GotoProjectMatchCandidate {
  return {
    status: "OPEN",
    contactPhone: null,
    contactType: null,
    primaryContact: false,
    ownerNumberMatches: true,
    ...input,
  }
}

describe("matchGotoInboundProject", () => {
  it("matches a formatted contact phone to its project", () => {
    const result = matchGotoInboundProject({
      body: "I will bring the bracing back Friday.",
      senderPhone: "+17195550123",
      priorConversationProjectIds: [],
      candidates: [
        project({
          id: "project-n-995",
          projectNumber: "N-995-00",
          contactPhone: "719.555.0123",
          contactType: "owner",
          primaryContact: true,
        }),
      ],
    })

    expect(result).toEqual({
      kind: "found",
      id: "project-n-995",
      projectNumber: "N-995-00",
      reason: "contact_phone",
    })
  })

  it("uses an explicit project number before a prior conversation or phone", () => {
    const result = matchGotoInboundProject({
      body: "Please put this on H-200-00.",
      senderPhone: "+17195550123",
      priorConversationProjectIds: ["project-n-100"],
      candidates: [
        project({
          id: "project-h-200",
          projectNumber: "H-200-00",
          contactPhone: "+17195550123",
        }),
        project({
          id: "project-n-100",
          projectNumber: "N-100-00",
          contactPhone: "+17195550123",
        }),
      ],
    })

    expect(result).toMatchObject({
      kind: "found",
      id: "project-h-200",
      reason: "project_number",
    })
  })

  it("does not match a contact through the wrong GoTo department number", () => {
    const result = matchGotoInboundProject({
      body: "Hello",
      senderPhone: "+17195550123",
      priorConversationProjectIds: [],
      candidates: [
        project({
          id: "project-n-100",
          projectNumber: "N-100-00",
          contactPhone: "+17195550123",
          ownerNumberMatches: false,
        }),
      ],
    })

    expect(result).toEqual({ kind: "missing", candidateProjectIds: [] })
  })

  it("returns ambiguous when one phone belongs to multiple open projects", () => {
    const result = matchGotoInboundProject({
      body: "Hello",
      senderPhone: "+17195550123",
      priorConversationProjectIds: [],
      candidates: [
        project({
          id: "project-1",
          projectNumber: "N-100-00",
          contactPhone: "+17195550123",
        }),
        project({
          id: "project-2",
          projectNumber: "N-101-00",
          contactPhone: "719-555-0123",
        }),
      ],
    })

    expect(result).toEqual({
      kind: "ambiguous",
      candidateProjectIds: ["project-1", "project-2"],
    })
  })
})
