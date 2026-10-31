import { describe, expect, it } from "vitest"

import { buildFollowUpQueue, followUpOwners, type FollowUpQueueRow } from "@/lib/domain/crm/rules"

const now = new Date("2026-10-30T18:00:00.000Z")

function row(overrides: Partial<FollowUpQueueRow> & Pick<FollowUpQueueRow, "projectId">): FollowUpQueueRow {
  return {
    projectNumber: null,
    projectName: overrides.projectId,
    clientName: null,
    clientStatus: "customer",
    jobStatusId: "intake",
    occurredAt: null,
    nextFollowUpAt: null,
    ownerName: null,
    ...overrides,
  }
}

describe("crm rules", () => {
  it("lists active internal staff as follow-up owners by name or email", () => {
    expect(
      followUpOwners([
        { id: "u1", displayName: "Avery", email: "a@example.com", active: true, role: "admin" },
        { id: "u2", displayName: null, email: "b@example.com", active: true, role: "office" },
        { id: "u3", displayName: "Inactive", email: "c@example.com", active: false, role: "admin" },
        { id: "u4", displayName: "Owner", email: "d@example.com", active: true, role: "client" },
      ]),
    ).toEqual([
      { id: "u1", displayName: "Avery" },
      { id: "u2", displayName: "b@example.com" },
    ])
  })

  it("groups rows by project and orders overdue before scheduled", () => {
    const queue = buildFollowUpQueue({
      rows: [
        row({ projectId: "scheduled", nextFollowUpAt: "2026-11-20T15:00:00.000Z", occurredAt: "2026-10-29T15:00:00.000Z" }),
        row({ projectId: "overdue", occurredAt: "2026-10-01T15:00:00.000Z" }),
        row({ projectId: "overdue", occurredAt: "2026-09-01T15:00:00.000Z" }),
        row({ projectId: "lead", clientStatus: "odd", occurredAt: "2026-10-01T15:00:00.000Z" }),
      ],
      customStatuses: [],
      agingSettings: { statuses: {} },
      now,
    })
    expect(queue.map((item) => item.projectId)).toEqual(["overdue", "lead", "scheduled"])
    expect(queue[0]?.state).toBe("overdue")
    expect(queue[0]?.lastClientInteractionAt).toBe("2026-10-01T15:00:00.000Z")
    expect(queue[0]?.jobStatusLabel).toBe("Intake")
    expect(queue[1]?.clientStatus).toBe("customer")
    expect(queue.at(-1)?.state).toBe("scheduled")
  })

  it("labels a company status from its custom definition", () => {
    const queue = buildFollowUpQueue({
      rows: [row({ projectId: "p1", jobStatusId: "custom-1", occurredAt: "2026-10-01T15:00:00.000Z" })],
      customStatuses: [{ id: "custom-1", label: "Warranty", cadenceDays: 5 }],
      agingSettings: { statuses: {} },
      now,
    })
    expect(queue).toHaveLength(1)
    expect(queue[0]?.jobStatusLabel).toBe("Warranty")
  })
})
