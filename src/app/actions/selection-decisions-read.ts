"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import {
  projectFinishSelections,
  projectChangeOrders,
  projectOperations,
} from "@/db/schema"
import {
  projectSelectionDecisionEvents,
  projectSelectionDecisions,
  projectSelectionRequests,
  projectSelectionProcurementLinks,
} from "@/db/schema-selection-decisions"
import { getProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { canFeature } from "@/lib/permission-enforcement"
import { selectionAccess } from "@/lib/selections/access"
import {
  parseApprovalHistory,
  approvalBlocker,
  parseSpecification,
  selectionSpecification,
  specificationJson,
} from "@/lib/selections/decisions"
import type {
  SelectionDecisionItem,
  SelectionWorkspace,
} from "@/lib/selections/types"

export async function getSelectionWorkspace(
  projectId: string,
  audience: SelectionWorkspace["audience"]
): Promise<SelectionWorkspace> {
  const { db, user, staff } = await selectionAccess(projectId, audience)
  const [
    selections,
    decisions,
    requests,
    links,
    changes,
    operations,
    approvalHistory,
  ] = await Promise.all([
    db
      .select()
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.projectId, projectId))
      .orderBy(
        asc(projectFinishSelections.roomName),
        asc(projectFinishSelections.sortOrder)
      ),
    db
      .select()
      .from(projectSelectionDecisions)
      .where(eq(projectSelectionDecisions.projectId, projectId)),
    audience === "sub_vendor"
      ? Promise.resolve([])
      : db
          .select()
          .from(projectSelectionRequests)
          .where(eq(projectSelectionRequests.projectId, projectId))
          .orderBy(asc(projectSelectionRequests.createdAt)),
    db
      .select()
      .from(projectSelectionProcurementLinks)
      .where(eq(projectSelectionProcurementLinks.projectId, projectId)),
    audience === "sub_vendor"
      ? Promise.resolve([])
      : db
          .select({
            id: projectChangeOrders.id,
            title: projectChangeOrders.title,
            status: projectChangeOrders.status,
            audience: projectChangeOrders.audience,
          })
          .from(projectChangeOrders)
          .where(eq(projectChangeOrders.projectId, projectId)),
    audience === "staff"
      ? db
          .select({
            id: projectOperations.id,
            title: projectOperations.title,
            type: projectOperations.sourceRecordType,
          })
          .from(projectOperations)
          .where(
            and(
              eq(projectOperations.projectId, projectId),
              inArray(projectOperations.sourceRecordType, [
                "rfq",
                "purchase_order",
              ])
            )
          )
      : Promise.resolve([]),
    audience === "sub_vendor"
      ? Promise.resolve([])
      : db
          .select()
          .from(projectSelectionDecisionEvents)
          .where(
            and(
              eq(projectSelectionDecisionEvents.projectId, projectId),
              eq(projectSelectionDecisionEvents.kind, "owner_approved")
            )
          )
          .orderBy(asc(projectSelectionDecisionEvents.createdAt)),
  ])
  // Reuse the portal's recipient checks; a link never grants a supplier new access.
  const partnerPreview =
    audience === "sub_vendor"
      ? await getProjectAudiencePreview(projectId, audience)
      : null
  const partnerOperations = new Map([
    ...(partnerPreview?.rfqs.map(
      (item) => [item.id, "rfqs"] satisfies [string, string]
    ) ?? []),
    ...(partnerPreview?.operations.map(
      (item) => [item.id, "commitments"] satisfies [string, string]
    ) ?? []),
  ])
  const items = selections.flatMap((row): SelectionDecisionItem[] => {
    const decision = decisions.find((item) => item.selectionId === row.id)
    if (audience !== "staff" && !decision?.published) return []
    const spec = decision
      ? parseSpecification(decision.specificationJson)
      : selectionSpecification(row)
    if (!spec) return []
    const current =
      !decision || decision.specificationJson === specificationJson(row)
    const ownLinks = links.filter((link) => link.selectionId === row.id)
    if (
      audience === "sub_vendor" &&
      (!decision?.approvedAt ||
        !current ||
        !ownLinks.some((link) => partnerOperations.has(link.operationId)))
    )
      return []
    const itemRequests = requests.filter(
      (request) => request.selectionId === row.id
    )
    const change = changes.find(
      (item) => item.id === decision?.changeOrderId && item.audience === "owner"
    )
    const partner = audience === "sub_vendor"
    return [
      {
        id: row.id,
        spec,
        currentSpec: audience === "staff" ? selectionSpecification(row) : spec,
        revision: decision?.revision ?? 0,
        published: decision?.published ?? false,
        current,
        decisionDueDate: decision?.decisionDueDate ?? null,
        allowanceCents: partner ? null : (decision?.allowanceCents ?? null),
        quotedCents: partner ? null : (decision?.quotedCents ?? null),
        scheduleImpact: decision?.scheduleImpact ?? null,
        ownerNote: partner ? null : (decision?.ownerNote ?? null),
        requiresChangeOrder:
          !partner && (decision?.requiresChangeOrder ?? false),
        changeOrderId: partner ? null : (change?.id ?? null),
        approvedAt: decision?.approvedAt ?? null,
        approvedByName: decision?.approvedByName ?? null,
        status:
          audience === "owner" &&
          row.status === "approved" &&
          !decision?.approvedAt
            ? "awaiting_owner_approval"
            : row.status,
        selectionUpdatedAt: row.updatedAt,
        approvalBlocker: partner
          ? "Shared approved specification"
          : approvalBlocker({
              current,
              published: decision?.published ?? false,
              approvedAt: decision?.approvedAt ?? null,
              allowanceCents: decision?.allowanceCents ?? null,
              quotedCents: decision?.quotedCents ?? null,
              scheduleImpact: decision?.scheduleImpact ?? null,
              requiresChangeOrder: decision?.requiresChangeOrder ?? false,
              changeOrderStatus: change?.status ?? null,
              openRequests: itemRequests.filter(
                (request) => request.status === "open"
              ).length,
            }),
        history: approvalHistory
          .filter((event) => event.selectionId === row.id)
          .flatMap((event) => {
            const snapshot = parseApprovalHistory(event.snapshotJson)
            return snapshot
              ? [
                  {
                    revision: event.revision,
                    actorName: event.actorName,
                    createdAt: event.createdAt,
                    ...snapshot,
                  },
                ]
              : []
          }),
        requests: itemRequests.map((request) => ({
          id: request.id,
          kind: request.kind,
          note: request.note,
          productUrl: request.productUrl,
          requesterName: request.requesterName,
          status: request.status,
          response: request.response,
          updatedAt: request.updatedAt,
          canEdit:
            audience === "owner" &&
            !staff &&
            request.requesterId === user.id &&
            request.status === "open",
        })),
        links: ownLinks.flatMap((link) => {
          const operation = operations.find(
            (item) => item.id === link.operationId
          )
          const section =
            audience === "staff"
              ? operation?.type === "rfq"
                ? "rfqs"
                : operation?.type === "purchase_order"
                  ? "purchase-orders"
                  : null
              : partnerOperations.get(link.operationId)
          if (!section) return []
          return [
            {
              id: link.id,
              label:
                operation?.title ??
                (section === "rfqs" ? "Supplier quote request" : "Commitment"),
              href:
                audience === "staff"
                  ? `/dashboard/projects/${encodeURIComponent(projectId)}/${section}#${section === "rfqs" ? "rfq" : "commitment"}-${encodeURIComponent(link.operationId)}`
                  : `/preview/projects/${encodeURIComponent(projectId)}/sub-vendor/${section}`,
              current: link.specificationJson === specificationJson(row),
            },
          ]
        }),
      },
    ]
  })
  return {
    projectId,
    audience,
    canWrite:
      audience === "staff"
        ? await canFeature(user, "finish-selections", "update")
        : audience === "owner" && !staff,
    items,
    changeOrders:
      audience === "staff"
        ? changes
            .filter((item) => item.audience === "owner")
            .map((item) => ({
              id: item.id,
              label: `${item.title} · ${item.status.replaceAll("_", " ")}`,
            }))
        : [],
    purchaseOrders: operations
      .filter((item) => item.type === "purchase_order")
      .map((item) => ({ id: item.id, label: item.title })),
  }
}
