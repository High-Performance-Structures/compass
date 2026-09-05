import type {
  AudienceOperationItem,
  AudienceRfi,
  AudienceRfq,
  ProjectAudiencePreview,
} from "@/app/actions/project-audience-preview"
import type { PortalReport, PortalReportItem } from "./portal-report"
import type { ProjectChangeOrderItem } from "@/app/actions/project-change-orders"
import type { WarrantyClaimItem } from "@/app/actions/project-warranty"
import { changeOrderDisplayStatus } from "@/lib/change-orders/status"
import { HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT } from "@/lib/change-orders/provenance"

function label(value: string): string {
  return value.replaceAll("_", " ")
}
function money(value: number | null): string | null {
  return value === null
    ? null
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value)
}

export function rfqReport(items: readonly AudienceRfq[]): PortalReport {
  return {
    title: "Requests for Quote",
    note: "Assigned scopes and submitted responses. A request for pricing does not authorize purchase or installation.",
    groups: items.map((item) => ({
      title: [item.number, item.title].filter(Boolean).join(" · "),
      items: [
        {
          title: "Request details",
          status: label(item.status),
          fields: [
            ["Company", item.companyName],
            ["Trade", item.vendorCategory],
            ["Due", item.dueDate],
          ],
          paragraphs: [["Description", item.description]],
        },
        ...item.scopeItems.map((line) => ({
          title: `${line.lineNumber}. ${line.description}`,
          fields: [
            ["Phase", line.phaseCode],
            ["Cost code", line.costCode],
          ] satisfies PortalReportItem["fields"],
          paragraphs: [["Scope notes", line.notes]] satisfies NonNullable<
            PortalReportItem["paragraphs"]
          >,
        })),
        ...item.documentLinks.map((link) => ({
          title: link.label,
          fields: [],
          paragraphs: [
            ["Document", link.url],
            ["Notes", link.notes],
          ] satisfies NonNullable<PortalReportItem["paragraphs"]>,
        })),
        ...(item.vendorResponse
          ? [
              {
                title:
                  item.vendorResponse.decision === "decline"
                    ? "Declined to quote"
                    : "Submitted quote",
                fields: [
                  ["Amount", money(item.vendorResponse.amount)],
                  ["Lead time", item.vendorResponse.leadTime],
                  ["Valid through", item.vendorResponse.validUntil],
                  ["Submitted by", item.vendorResponse.responderName],
                  ["Submitted at", item.vendorResponse.submittedAt],
                ] satisfies PortalReportItem["fields"],
                paragraphs: [
                  ["Response", item.vendorResponse.notes],
                ] satisfies NonNullable<PortalReportItem["paragraphs"]>,
              },
              ...item.vendorResponse.lines.map((line) => ({
                title: `Quoted line ${line.lineNumber}: ${item.scopeItems.find((scope) => scope.lineNumber === line.lineNumber)?.description ?? "Scope"}`,
                fields: [
                  ["Amount", money(line.amount)],
                ] satisfies PortalReportItem["fields"],
                paragraphs: [["Notes", line.notes]] satisfies NonNullable<
                  PortalReportItem["paragraphs"]
                >,
              })),
            ]
          : []),
      ],
    })),
  }
}

export function rfiReport(items: readonly AudienceRfi[]): PortalReport {
  return {
    title: "Requests for Information",
    note: "Project questions and responses available in your workspace. Check Compass for the latest answer.",
    groups: items.map((item) => ({
      title: `${item.rfiNumber} · ${item.subject}`,
      items: [
        {
          title: "Question and response",
          status: label(item.status),
          fields: [
            ["Priority", label(item.priority)],
            ["Requested by", item.requesterName],
            ["Assigned to", item.assignedToName],
            ["Company", item.companyName],
            ["Submitted", item.submittedAt],
            ["Due", item.dueDate],
            ["Answered", item.answeredAt],
          ],
          paragraphs: [
            ["Question", item.question],
            ["Answer", item.answer ?? "Awaiting response"],
          ],
        },
      ],
    })),
  }
}

export function commitmentReport(
  items: readonly AudienceOperationItem[],
): PortalReport {
  return {
    title:
      items.length === 1 && items[0]?.sourceRecordType === "purchase_order"
        ? "Purchase Order"
        : "Project Commitments",
    note: "Assigned commitment details available in your workspace. Check Compass for current status before fulfillment.",
    groups: items.map((item) => ({
      title: [item.sourceRecordNumber, item.title].filter(Boolean).join(" · "),
      items: [
        {
          title: label(item.sourceRecordType),
          status: label(item.status),
          fields: [
            ["Company", item.companyName],
            ["Assigned to", item.assigneeName],
            ["Start", item.startDate],
            ["Due", item.dueDate],
            ["Amount", money(item.amount)],
            ["Acknowledged", item.acknowledgement ? "Yes" : "No"],
            [
              "Vendor status",
              item.latestVendorStatus
                ? label(item.latestVendorStatus.status)
                : null,
            ],
          ],
          paragraphs: [
            ["Scope", item.description],
            ["Vendor update", item.latestVendorStatus?.note ?? null],
          ],
        },
      ],
    })),
  }
}

export function directoryReport(data: ProjectAudiencePreview): PortalReport {
  return {
    title: "Project Team",
    note: "Project contacts available in your workspace.",
    groups: [
      {
        title: data.project.name,
        items: data.contacts.map((item) => ({
          title: item.displayName,
          fields: [
            ["Company", item.companyName],
            ["Role", item.role],
            ["Trade", item.trade],
            ["Email", item.email],
            ["Phone", item.phone],
          ],
        })),
      },
    ],
  }
}

export function changeOrderReport(
  items: readonly ProjectChangeOrderItem[],
): PortalReport {
  return {
    title: "Change Orders",
    note: "Scope, pricing and status available in your workspace. This report does not replace an executed agreement.",
    groups: items.map((item) => ({
      title: `${item.changeOrderNumber} · ${item.title}`,
      items: [
        {
          title: "Change details",
          status: changeOrderDisplayStatus(item.status, item.sourceType),
          fields: [
            // Historical requester fields are project defaults, not evidence
            // of who initiated this change. Match the shared detail view.
            ...(item.sourceType === "buildertrend_import"
              ? ([
                  ["Initiator", "Not verified from Buildertrend"],
                  ["Purpose", "Not classified"],
                ] satisfies PortalReportItem["fields"])
              : ([
                  ["Requested by", item.requesterName],
                  ["Company", item.requesterCompany],
                ] satisfies PortalReportItem["fields"])),
            [
              "Amount",
              money(item.amountCents === null ? null : item.amountCents / 100),
            ],
            ["Schedule impact (days)", item.scheduleImpactDays],
            ["Submitted", item.submittedAt],
          ],
          paragraphs: [
            ...(item.sourceType === "buildertrend_import"
              ? ([
                  ["Historical text", HISTORICAL_CHANGE_ORDER_TEXT_CONTEXT],
                  ["Recorded scope", item.scope],
                  ["Recorded reason", item.reason],
                ] satisfies NonNullable<PortalReportItem["paragraphs"]>)
              : ([
                  ["Scope", item.scope],
                  ["Reason", item.reason],
                ] satisfies NonNullable<PortalReportItem["paragraphs"]>)),
          ],
        },
        ...item.lines.map((line) => ({
          title: `${line.lineNumber}. ${line.description}`,
          fields: [
            [
              "Amount",
              money(line.amountCents === null ? null : line.amountCents / 100),
            ],
          ] satisfies PortalReportItem["fields"],
        })),
        ...item.documents.map((document) => ({
          title: document.label,
          fields: [],
          paragraphs: [
            ["Document", document.url],
            ["Notes", document.notes],
          ] satisfies NonNullable<PortalReportItem["paragraphs"]>,
        })),
      ],
    })),
  }
}

export function warrantyReport(
  items: readonly WarrantyClaimItem[],
): PortalReport {
  return {
    title: "Warranty Requests",
    note: "Warranty request details and resolutions available in your workspace.",
    groups: items.map((item) => ({
      title: `${item.claimNumber} · ${item.title}`,
      items: [
        {
          title: "Request details",
          status: label(item.status),
          fields: [
            ["Location", item.location],
            ["Category", item.category],
            ["Priority", label(item.priority)],
            ["Requested by", item.claimantName],
            ["Assigned to", item.assignedName],
            ["Submitted", item.submittedAt],
            ["Scheduled", item.scheduledFor],
            ["Resolved", item.resolvedAt],
            ["Owner confirmed", item.ownerConfirmedAt],
          ],
          paragraphs: [
            ["Description", item.description],
            ["Resolution", item.resolutionSummary],
          ],
        },
      ],
    })),
  }
}
