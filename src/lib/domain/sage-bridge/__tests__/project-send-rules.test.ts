import { describe, expect, it } from "vitest"

import {
  isSageClientNameMatchError,
  payloadWithSageClient,
  projectSageFailureReason,
  projectSageStatus,
  resolveSageJobCreateClient,
  sageClientNameKey,
  sageJobCreateBlocker,
  sageJobCreateClient,
  similarSageClientChoices,
  type SageJobCreatePreview,
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
    })).toEqual({ kind: "not_linked", create: null, createBlocker: null })
  })

  const preview: SageJobCreatePreview = {
    jobName: "N-100-00-Example Job", clientName: "Pat Example", jobTypeName: "Customer", jobStatusName: "Intake",
    client: { kind: "new" },
  }

  it("offers Create in Sage for a job with no Sage job and no write", () => {
    expect(projectSageStatus({
      sageJobNumber: null, sageJobStatusName: null, write: null, clientName: null, clientChoices: [],
      create: { preview, blocker: null },
    })).toEqual({ kind: "not_linked", create: preview, createBlocker: null })
    expect(projectSageStatus({
      sageJobNumber: null, sageJobStatusName: null, write: null, clientName: null, clientChoices: [],
      create: { preview: null, blocker: "Choose this job's client" },
    })).toEqual({ kind: "not_linked", create: null, createBlocker: "Choose this job's client" })
  })

  it("never offers Create in Sage for a linked, sending, failed or already-succeeded job", () => {
    const create = { preview, blocker: null }
    const base = { sageJobStatusName: null, clientName: "Pat Example", clientChoices: [], create }
    expect(projectSageStatus({ ...base, sageJobNumber: "5001", write: null }).kind).toBe("linked")
    expect(projectSageStatus({ ...base, sageJobNumber: null, write: { status: "queued", errorMessage: null } }).kind).toBe("sending")
    expect(projectSageStatus({ ...base, sageJobNumber: null, write: { status: "failed", errorMessage: "x" } }).kind).toBe("failed")
    expect(projectSageStatus({ ...base, sageJobNumber: null, write: { status: "succeeded", errorMessage: null } }))
      .toEqual({ kind: "not_linked", create: null, createBlocker: null })
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

describe("Create in Sage client", () => {
  const flatiron = { sageRecordId: "AAAAAAAA-1111-2222-3333-444444444444", sageClientNumber: "2001", name: "Flatiron Development & Custom Homes, LLC", email: null }
  const exact = { sageRecordId: "BBBBBBBB-1111-2222-3333-444444444444", sageClientNumber: "2002", name: "flatiron  development", email: "office@example.com" }
  const other = { sageRecordId: "CCCCCCCC-1111-2222-3333-444444444444", sageClientNumber: "2003", name: "Flatirons Roofing", email: null }
  const unlinked = { sageClientId: null, sageClientNumber: null }

  it("offers a longer Sage name that starts with the Compass name, and skips unrelated ones", () => {
    expect(similarSageClientChoices("Flatiron Development", [flatiron, other])).toEqual({ choices: [flatiron], exactMatch: false })
  })

  it("puts exact matches first and flags them", () => {
    expect(similarSageClientChoices("Flatiron Development", [flatiron, exact])).toEqual({ choices: [exact, flatiron], exactMatch: true })
  })

  it("uses a linked client, otherwise the choices, otherwise a new client", () => {
    expect(sageJobCreateClient({ sageClientId: "X", sageClientNumber: "9" }, { choices: [flatiron], exactMatch: false }))
      .toEqual({ kind: "linked", sageClientNumber: "9" })
    expect(sageJobCreateClient(unlinked, { choices: [flatiron], exactMatch: false }))
      .toEqual({ kind: "choose", choices: [flatiron], allowNew: true })
    expect(sageJobCreateClient(unlinked, { choices: [exact], exactMatch: true }))
      .toEqual({ kind: "choose", choices: [exact], allowNew: false })
    expect(sageJobCreateClient(unlinked, { choices: [], exactMatch: false })).toEqual({ kind: "new" })
  })

  it("needs a client pick and never adds a duplicate of an exact-name Sage client", () => {
    const choose = { kind: "choose", choices: [exact, flatiron], allowNew: false } as const
    expect(resolveSageJobCreateClient(choose, unlinked, null).ok).toBe(false)
    expect(resolveSageJobCreateClient(choose, unlinked, { kind: "new_client" }).ok).toBe(false)
    expect(resolveSageJobCreateClient(choose, unlinked, { kind: "sage_client", sageRecordId: other.sageRecordId, sageClientNumber: "2003" }).ok).toBe(false)
    expect(resolveSageJobCreateClient(choose, unlinked, {
      kind: "sage_client", sageRecordId: flatiron.sageRecordId.toLowerCase(), sageClientNumber: "2001",
    })).toEqual({ ok: true, link: { sageClientId: flatiron.sageRecordId, sageClientNumber: "2001" } })
    expect(resolveSageJobCreateClient({ ...choose, allowNew: true }, unlinked, { kind: "new_client" })).toEqual({ ok: true, link: null })
  })

  it("keeps the linked client and adds a new one only when nothing matches", () => {
    expect(resolveSageJobCreateClient({ kind: "linked", sageClientNumber: "9" }, { sageClientId: "X", sageClientNumber: "9" }, null))
      .toEqual({ ok: true, link: { sageClientId: "X", sageClientNumber: "9" } })
    expect(resolveSageJobCreateClient({ kind: "new" }, unlinked, null)).toEqual({ ok: true, link: null })
  })

  it("blocks a job with no client or a half-linked client", () => {
    expect(sageJobCreateBlocker(null)).toContain("Information page")
    expect(sageJobCreateBlocker({ sageClientId: "X", sageClientNumber: null })).toContain("incomplete Sage link")
    expect(sageJobCreateBlocker(unlinked)).toBeNull()
  })
})
