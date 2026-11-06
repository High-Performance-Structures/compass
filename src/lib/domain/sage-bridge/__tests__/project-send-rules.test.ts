import { describe, expect, it } from "vitest"

import {
  isSageClientNameMatchError,
  payloadWithSageClient,
  projectSageFailureReason,
  projectSageStatus,
  sageClientNameKey,
} from "@/lib/domain/sage-bridge/project-send-rules"

const NO_EMAIL = "A Sage client matches the requested name but has no email. Link its Sage client ID and number in Compass before filling the email; no write was attempted."
const OTHER_EMAIL = "A Sage client matches the requested name but not the requested email; no write was attempted."
const choice = { sageRecordId: "00000000-1111-2222-3333-444444444444", sageClientNumber: "1001", name: "Pat Example", email: null }

describe("projectSageStatus", () => {
  it("shows the linked Sage job, whatever the last write said", () => {
    expect(projectSageStatus({
      sageJobNumber: "5001", sageJobStatusName: "Ordered",
      write: { status: "failed", errorMessage: NO_EMAIL }, clientName: "Pat Example", clientChoices: [choice],
    })).toEqual({ kind: "linked", jobNumber: "5001", statusName: "Ordered" })
  })

  it("never offers a send for a job Compass didn't create", () => {
    expect(projectSageStatus({
      sageJobNumber: null, sageJobStatusName: null, write: null, clientName: null, clientChoices: [],
    })).toEqual({ kind: "not_linked" })
  })

  it("shows a queued or claimed write as sending", () => {
    for (const status of ["queued", "running"]) {
      expect(projectSageStatus({
        sageJobNumber: null, sageJobStatusName: null, write: { status, errorMessage: null },
        clientName: "Pat Example", clientChoices: [],
      }).kind).toBe("sending")
    }
  })

  it("offers the same-name Sage clients when the writer stopped on a name match", () => {
    const status = projectSageStatus({
      sageJobNumber: null, sageJobStatusName: null, write: { status: "failed", errorMessage: NO_EMAIL },
      clientName: "Pat Example", clientChoices: [choice],
    })
    expect(status).toEqual({
      kind: "failed",
      reason: "Sage already has a client named Pat Example with no email. Choose that client to use it for this job.",
      clientChoices: [choice],
    })
  })

  it("drops client choices for other failures", () => {
    const status = projectSageStatus({
      sageJobNumber: null, sageJobStatusName: null,
      write: { status: "failed", errorMessage: "Sage jobsts lookup for 'Ordered' returned 0 rows." },
      clientName: "Pat Example", clientChoices: [choice],
    })
    expect(status).toEqual({
      kind: "failed",
      reason: "Sage didn't accept this job: Sage jobsts lookup for 'Ordered' returned 0 rows.",
      clientChoices: [],
    })
  })
})

describe("Sage failure wording", () => {
  it("recognizes both same-name client stops", () => {
    expect(isSageClientNameMatchError(NO_EMAIL)).toBe(true)
    expect(isSageClientNameMatchError(OTHER_EMAIL)).toBe(true)
    expect(isSageClientNameMatchError("Duplicate Sage match is ambiguous; no write was attempted.")).toBe(false)
    expect(isSageClientNameMatchError(null)).toBe(false)
  })

  it("explains a different-email match and an empty error", () => {
    expect(projectSageFailureReason(OTHER_EMAIL, "Pat Example")).toContain("with a different email")
    expect(projectSageFailureReason(null, null)).toBe("Sage didn't accept this job.")
  })
})

describe("payloadWithSageClient", () => {
  const payload = JSON.stringify({
    operationType: "ensure_client_and_job",
    company: "High Performance Structures Inc",
    client: { compassCustomerId: "c1", sageClientId: null, sageClientNumber: null, name: "Pat Example" },
    job: { compassProjectId: "p1", name: "N-100-00-Example Job" },
  })

  it("fills in the chosen Sage client and leaves the job alone", () => {
    const next = payloadWithSageClient(payload, { sageClientId: "00000000-1111-2222-3333-444444444444", sageClientNumber: "1001" })
    expect(next).not.toBeNull()
    const parsed: unknown = JSON.parse(next ?? "null")
    expect(parsed).toMatchObject({
      client: { sageClientId: "00000000-1111-2222-3333-444444444444", sageClientNumber: "1001", name: "Pat Example" },
      job: { name: "N-100-00-Example Job" },
    })
  })

  it("keeps the payload as is without a link and rejects anything else", () => {
    expect(payloadWithSageClient(payload, null)).toBe(payload)
    expect(payloadWithSageClient("not json", null)).toBeNull()
    expect(payloadWithSageClient(JSON.stringify({ operationType: "update_client_email", client: {} }), null)).toBeNull()
  })
})

describe("sageClientNameKey", () => {
  it("ignores case and extra spaces", () => {
    expect(sageClientNameKey("  Jody   REEVES ")).toBe("jody reeves")
  })
})
