import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ProjectArchivedChangeOrderDetail } from "@/components/projects/project-archived-change-order-detail"
import {
  ProjectArchivedChangeOrderList,
  ProjectArchivedChangeOrderSection,
} from "@/components/projects/project-archived-change-order-list"
import {
  parseArchivedBuildertrendChangeOrder,
  type BuildertrendArchiveObservationRow,
  type BuildertrendArchiveSourceRow,
} from "@/lib/change-orders/buildertrend-archive"

const projectId = "project-loomis"
const jobId = "35400494"
const sourceId = "10190380"
const sourceKey = `job:${jobId}:change_order:${sourceId}`
const sourceUrl =
  `https://buildertrend.net/app/ChangeOrders/${sourceId}/${jobId}/Details`
const archiveFileId = "1-iCVyTmRvdG18G46MKPhTX6et7GNhdpg"
const archiveUrl =
  `https://drive.google.com/file/d/${archiveFileId}/view?usp=drivesdk`
const archiveSha =
  "e4a4559ab1c1848312d35cb9cbcad166e4d0ddd0bce0a117acadf5b47a7802fa"

const row: BuildertrendArchiveSourceRow = {
  id: "stage-co0008",
  organizationId: "org-loomis",
  projectId,
  requestedProjectId: projectId,
  sourceKey,
  sourceRecordType: "change_order",
  buildertrendJobId: jobId,
  buildertrendRecordId: sourceId,
  buildertrendRecordNumber: "O-170-0008",
  buildertrendUrl: sourceUrl,
  title: "July 2026 Variances",
  sourceStatus: "Approved (list and detail)",
  // A project-owner label is context only and must never establish initiation.
  clientName: "Owner Family",
  rawPayloadJson: "{}",
  verifiedArchiveDriveFileId: archiveFileId,
  verifiedArchiveDriveUrl: archiveUrl,
  reviewStatus: "verified",
  promotionStatus: "archive_only",
  updatedAt: "2026-09-06T16:36:00Z",
}

function sourcePayload(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    sourceArchiveSha256: archiveSha,
    driveFileId: archiveFileId,
    sourceKey,
    sourceStatus: "Approved (list and detail)",
    sourceRecord: {
      sourceId,
      number: "O-170-0008",
      title: "July 2026 Variances",
      sourceUrl,
      listStatus: "Approved",
      detailStatus: "Approved",
      sourceScope:
        "The remaining variances are covered by leftover budget and contingency allowance.",
      requiredApprovers: ["Owner Family"],
      lines: [
        ["33 36 00 - Utility Septic Tanks", "$24.85", "1.0000", "$24.85"],
        ["09 29 00 - Gypsum Wallboard", "$24.85", "-1.0000", "-$24.85"],
      ],
    },
    sourceLineIdentity: {
      buildertrendChangeOrderId: sourceId,
      number: "O-170-0008",
      url: sourceUrl,
      rows: [
        {
          displayOrder: 1,
          sourceLineIdFromRowKey: "19874702",
          displayedTitle: "--",
          displayedCostCode: "33 36 00 - Utility Septic Tanks",
          displayedClientPrice: "$24.85",
        },
        {
          displayOrder: 2,
          sourceLineIdFromRowKey: "19874698",
          displayedTitle: "--",
          displayedCostCode: "09 29 00 - Gypsum Wallboard",
          displayedClientPrice: "-$24.85",
        },
      ],
    },
    expandedActivity: {
      buildertrendChangeOrderId: sourceId,
      buildertrendJobId: jobId,
      sourceUrl,
      events: [
        {
          displayOrder: 1,
          kind: "Approved",
          actor: "Tanis Loomis",
          displayedAt: "Aug 4, 2026, 8:36 AM",
          changes: [],
        },
        {
          displayOrder: 2,
          kind: "Sent / Pending",
          actor: "Sylvi Vogel",
          displayedAt: "Aug 4, 2026, 8:30 AM",
          changes: [
            { kind: "Scope of Work updated", changedTextExposed: false },
            { field: "Title", from: "O-170-0008", to: "July 2026 Variances" },
          ],
        },
      ],
    },
    decision: {
      sourcePurpose: "variance",
      requester: "unknown",
      sourceApprovalActor: "Tanis Loomis",
      budgetMutationApplied: false,
    },
    stagingRawPayload: {
      archive: { driveFileId: archiveFileId, driveUrl: archiveUrl },
      contractSemantics: {
        purpose: "variance",
        requesterEstablishedBySource: false,
        approvalActorIsRequester: false,
      },
    },
  }
}

function observation(
  payload: Readonly<Record<string, unknown>> = sourcePayload()
): BuildertrendArchiveObservationRow {
  return {
    id: "observation-co0008",
    organizationId: row.organizationId,
    entityKind: "record",
    entityKey: row.sourceKey,
    entityId: row.id,
    observedPayloadJson: JSON.stringify(payload),
    observedAt: "2026-09-06T16:36:00Z",
  }
}

function parsedRecord() {
  const result = parseArchivedBuildertrendChangeOrder({
    projectId,
    buildertrendJobId: jobId,
    row,
    observation: observation(),
  })
  expect(result.kind).toBe("record")
  if (result.kind !== "record") throw new Error(result.reason)
  return result.record
}

describe("Buildertrend archived change-order evidence", () => {
  it("renders a source-approved variance without inventing an owner request or budget state", () => {
    const record = parsedRecord()
    expect(record.displayStatus).toBe("Approved · Buildertrend")
    expect(record.purpose).toBe("Variance")
    expect(record.requester).toBe("Unknown — not established by source")
    expect(record.approvalActor).toBe("Tanis Loomis")
    expect(record.ownerRequested).toBe(false)
    expect(record.budgetActive).toBe(false)
    expect(record.lines).toHaveLength(2)
    expect(record.activity).toHaveLength(2)
    expect(record.archiveEvidence.status).toBe("verified")
    expect(record.manifestEvidence.status).toBe("held")
  })

  it("keeps owner-labelled source context separate from requester identity", () => {
    const record = parsedRecord()
    expect(row.clientName).toBe("Owner Family")
    expect(record.requester).not.toContain("Owner Family")
    expect(record.ownerRequested).toBe(false)
    expect(record.approvalActor).not.toBe(record.requester)
  })

  it("shows captured lines, activity, role boundaries, and held manifest evidence in app", () => {
    const record = parsedRecord()
    const list = renderToStaticMarkup(
      React.createElement(ProjectArchivedChangeOrderList, {
        records: [record],
        holds: [],
        detailBaseHref: "/dashboard/projects/project-loomis/change-orders",
      })
    )
    const detail = renderToStaticMarkup(
      React.createElement(ProjectArchivedChangeOrderDetail, {
        record,
        backHref: "/dashboard/projects/project-loomis/change-orders",
      })
    )
    for (const markup of [list, detail]) {
      expect(markup).toContain("Approved · Buildertrend")
      expect(markup).toContain("Variance")
      expect(markup).toContain("not budget-active")
      expect(markup).not.toContain("Requested by")
    }
    expect(detail).toContain("Unknown — not established by source")
    expect(detail).toContain("Tanis Loomis")
    expect(detail).toContain("33 36 00 - Utility Septic Tanks")
    expect(detail).toContain("Aug 4, 2026, 8:36 AM")
    expect(detail).toContain("Provenance manifest publication is held")
    expect(detail).not.toContain("Owner Family")
    expect(detail).not.toContain("Buildertrend source actor</dd>")
  })

  it("holds the whole record when immutable identity evidence drifts", () => {
    const result = parseArchivedBuildertrendChangeOrder({
      projectId,
      buildertrendJobId: jobId,
      row,
      observation: { ...observation(), entityKey: "wrong-source-key" },
    })
    expect(result).toEqual({
      kind: "held",
      sourceRecordId: row.id,
      reason: "Matching immutable source evidence is not available.",
    })
  })

  it("withholds a mismatched archive link but retains independently captured lines and activity", () => {
    const result = parseArchivedBuildertrendChangeOrder({
      projectId,
      buildertrendJobId: jobId,
      row: { ...row, verifiedArchiveDriveFileId: "different-drive-file" },
      observation: observation(),
    })
    expect(result.kind).toBe("record")
    if (result.kind !== "record") throw new Error(result.reason)
    expect(result.record.archiveEvidence.status).toBe("held")
    expect(result.record.lines).toHaveLength(2)
    expect(result.record.activity).toHaveLength(2)
  })

  it("rejects unallowlisted source statuses instead of coercing workflow state", () => {
    const payload = { ...sourcePayload(), sourceStatus: "Executed" }
    const result = parseArchivedBuildertrendChangeOrder({
      projectId,
      buildertrendJobId: jobId,
      row: { ...row, sourceStatus: "Executed" },
      observation: observation(payload),
    })
    expect(result.kind).toBe("held")
  })

  it("shows genuine archive load failures without turning forbidden or inapplicable results into history disclosures", () => {
    const loadFailure = renderToStaticMarkup(
      React.createElement(ProjectArchivedChangeOrderSection, {
        workspace: {
          success: false,
          reason: "load_error",
          error: "Archived change-order evidence exceeds the bounded review window.",
        },
        detailBaseHref: "/dashboard/projects/project-loomis/change-orders",
      })
    )
    expect(loadFailure).toContain("Buildertrend archive could not be loaded")
    expect(loadFailure).toContain("not an empty-history result")
    const hiddenReasons: readonly ("forbidden" | "not_applicable")[] = [
      "forbidden",
      "not_applicable",
    ]
    for (const reason of hiddenReasons) {
      const hidden = renderToStaticMarkup(
        React.createElement(ProjectArchivedChangeOrderSection, {
          workspace: { success: false, reason, error: "Hidden result" },
          detailBaseHref: "/dashboard/projects/project-loomis/change-orders",
        })
      )
      expect(hidden).toBe("")
    }
  })
})
