import type {
  AudienceScheduleItem,
  ProjectAudiencePreview,
} from "@/app/actions/project-audience-preview"
import type { ProjectBudgetApplicationItem } from "@/app/actions/project-budget"
import type { ProjectChangeOrderItem } from "@/app/actions/project-change-orders"
import { changeOrderStatusLabel } from "@/lib/change-orders/status"
import {
  ownerUpdatePreviewHref,
  projectAudienceSectionHref,
} from "@/lib/project-audience-preview-routes"
import { portalPurchaseOrderCanReceiveResponse } from "@/lib/purchase-orders/portal-response"
import { portalRfqCanReceiveResponse } from "@/lib/rfqs/portal-response"
import { dateKeyInTimeZone } from "@/lib/work-calendar"

export type DashboardChangeOrder = Pick<
  ProjectChangeOrderItem,
  "id" | "title" | "changeOrderNumber" | "status" | "canEdit"
>
export type DashboardPayApplication = Pick<
  ProjectBudgetApplicationItem,
  "id" | "applicationNumber" | "periodTo"
>
export type AudienceDashboardFinancials = {
  readonly changeOrders: readonly DashboardChangeOrder[] | null
  readonly applications: readonly DashboardPayApplication[] | null
}
export type AudienceDashboardLink = {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly label: string
  readonly href: string
  readonly dueDate: string | null
}

export function audienceDashboardDate(now: Date): {
  readonly today: string
  readonly greeting: string
} {
  // Match the internal dashboard's default project calendar zone, including DST.
  const timeZone = "America/Denver"
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now)
  )
  return {
    today: dateKeyInTimeZone(now, timeZone),
    greeting:
      hour < 12
        ? "Good morning"
        : hour < 17
          ? "Good afternoon"
          : "Good evening",
  }
}

export function audienceDashboardDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
}

export function audienceDashboardHorizon(
  items: readonly AudienceScheduleItem[],
  today: string
): readonly {
  readonly date: string
  readonly items: readonly AudienceScheduleItem[]
}[] {
  return Array.from({ length: 5 }, (_, offset) => {
    const day = new Date(`${today}T12:00:00Z`)
    day.setUTCDate(day.getUTCDate() + offset)
    const date = day.toISOString().slice(0, 10)
    return {
      date,
      items: items.filter(
        (item) =>
          item.startDate <= date && item.endDate >= date && isUpcomingWork(item)
      ),
    }
  })
}

function isUpcomingWork(item: AudienceScheduleItem): boolean {
  return (
    item.percentComplete < 100 &&
    !["complete", "completed", "cancelled", "canceled"].includes(
      item.status.toLowerCase()
    )
  )
}

export function audienceDashboardNeedsConfirmation(
  item: AudienceScheduleItem
): boolean {
  // Multi-assignee responses own confirmation when present, just as on the schedule page.
  return item.assignees.length > 0
    ? item.assignees.some(
        (assignee) =>
          assignee.viewerCanRespond && assignee.responseStatus === "pending"
      )
    : item.viewerCanConfirm && item.confirmationStatus === "pending"
}

export function audienceDashboardModel(
  data: ProjectAudiencePreview,
  financials: AudienceDashboardFinancials,
  today: string
): {
  readonly priorities: readonly AudienceDashboardLink[]
  readonly recent: readonly AudienceDashboardLink[]
  readonly alerts: readonly {
    readonly title: string
    readonly count: number
    readonly href: string
  }[]
} {
  const route = data.audience === "owner" ? "owner" : "sub-vendor"
  const href = (
    section: Parameters<typeof projectAudienceSectionHref>[2]
  ): string => projectAudienceSectionHref(data.project.id, route, section)
  const confirmations = data.scheduleItems.filter(
    (item) =>
      item.endDate >= today &&
      isUpcomingWork(item) &&
      audienceDashboardNeedsConfirmation(item)
  )
  const changes = (financials.changeOrders ?? []).filter(
    (item) =>
      (item.status === "needs_information" && item.canEdit) ||
      (data.audience === "owner" &&
        ["approved_for_owner", "signature_pending"].includes(item.status))
  )
  const quotes =
    data.audience === "sub_vendor"
      ? data.rfqs.filter(
          (item) =>
            portalRfqCanReceiveResponse(item.status) &&
            item.vendorResponse === null
        )
      : []
  const commitments =
    data.audience === "sub_vendor"
      ? data.operations.filter(
          (item) =>
            item.sourceRecordType === "purchase_order" &&
            item.acknowledgement === null &&
            portalPurchaseOrderCanReceiveResponse(item.status)
        )
      : []
  const priorities: AudienceDashboardLink[] = [
    ...confirmations.map((item) => ({
      id: `schedule-${item.id}`,
      title: item.title,
      detail: "Confirm your dates or propose a change",
      label: "Schedule",
      href: href("schedule"),
      dueDate: item.startDate,
    })),
    ...changes.map((item) => ({
      id: `change-${item.id}`,
      title: item.title,
      detail: `${item.changeOrderNumber} · ${changeOrderStatusLabel(item.status)}`,
      label: item.status === "needs_information" ? "Reply requested" : "Review",
      href: `${href("change-orders")}/${encodeURIComponent(item.id)}`,
      dueDate: null,
    })),
    ...quotes.map((item) => ({
      id: `rfq-${item.id}`,
      title: item.title,
      detail: `${item.number ?? "RFQ"} · Submit pricing or decline the request`,
      label: "Quote requested",
      href: `${href("rfqs")}#rfq-${encodeURIComponent(item.id)}`,
      dueDate: item.dueDate,
    })),
    ...commitments.map((item) => ({
      id: `commitment-${item.id}`,
      title: item.title,
      detail: `${item.sourceRecordNumber ?? "Purchase order"} · Acknowledge or send an update`,
      label: "Commitment",
      href: `${href("commitments")}#commitment-${encodeURIComponent(item.id)}`,
      dueDate: item.dueDate,
    })),
  ]
  priorities.sort(
    (left, right) =>
      (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999") ||
      left.id.localeCompare(right.id)
  )

  const recent: AudienceDashboardLink[] =
    data.audience === "owner"
      ? [
          ...(financials.applications ?? []).slice(0, 1).map((item) => ({
            id: `application-${item.id}`,
            title: `Review pay application ${item.applicationNumber}`,
            detail: item.periodTo
              ? `Published application · Through ${audienceDashboardDateLabel(item.periodTo)}`
              : "Published pay application",
            label: "Budget / G703",
            href: href("budget"),
            dueDate: null,
          })),
          ...data.ownerUpdates.slice(0, 2).map((item) => ({
            id: `update-${item.id}`,
            title: item.title,
            detail: `Published update · ${audienceDashboardDateLabel(item.updateDate)}`,
            label: "Owner update",
            href: ownerUpdatePreviewHref(data.project.id, item.id),
            dueDate: null,
          })),
        ]
      : [
          ...data.rfis
            .filter((item) => item.answer && item.answeredAt)
            .toSorted((a, b) =>
              (b.answeredAt ?? "").localeCompare(a.answeredAt ?? "")
            )
            .slice(0, 2)
            .map((item) => ({
              id: `rfi-${item.id}`,
              title: item.subject,
              detail: `${item.rfiNumber} · Response from the project team`,
              label: "RFI answer",
              href: `${href("rfis")}#rfi-${encodeURIComponent(item.id)}`,
              dueDate: null,
            })),
          ...data.operations
            .filter((item) => !commitments.includes(item))
            .slice(0, 1)
            .map((item) => ({
              id: `operation-${item.id}`,
              title: item.title,
              detail: `${item.sourceRecordNumber ?? "Commitment"} · ${item.status.replaceAll("_", " ")}`,
              label: "View commitment",
              href: `${href("commitments")}#commitment-${encodeURIComponent(item.id)}`,
              dueDate: null,
            })),
        ]
  return {
    priorities,
    recent,
    alerts: [
      {
        title: "Schedule responses",
        count: confirmations.length,
        href: href("schedule"),
      },
      ...(financials.changeOrders === null
        ? []
        : [
            {
              title: "Changes to review",
              count: changes.length,
              href: href("change-orders"),
            },
          ]),
      ...(data.audience === "owner"
        ? financials.applications === null
          ? []
          : [
              {
                title: "Published pay apps",
                count: financials.applications.length,
                href: href("budget"),
              },
            ]
        : [
            {
              title: "Quotes to respond",
              count: quotes.length,
              href: href("rfqs"),
            },
            {
              title: "POs to acknowledge",
              count: commitments.length,
              href: href("commitments"),
            },
          ]),
    ],
  }
}
