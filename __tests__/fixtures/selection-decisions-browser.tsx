import * as React from "react"
import { createRoot } from "react-dom/client"
import { SelectionDecisionWorkspace } from "@/components/selections/selection-decision-workspace"
import type {
  SelectionDecisionItem,
  SelectionWorkspace,
} from "@/lib/selections/types"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { QuickAddProvider } from "@/components/quick-add-menu"
import { dashboardFixture } from "./project-audience-dashboard"
import { quickAddHref } from "@/lib/quick-add"

const spec = {
  roomName: "Kitchen",
  name: "Kitchen faucet",
  category: "Plumbing fixtures",
  description:
    "A timeless bridge faucet with a hand-finished surface, selected to complement the natural stone and warm oak cabinetry.",
  quantity: 1,
  manufacturer: "Waterworks",
  model: "Henry",
  colorFinish: "Unlacquered brass",
  supplierName: "Architectural Fixtures",
  productUrl: "https://example.test/faucet",
}
const params = new URLSearchParams(window.location.search)
const staff = params.has("staff"),
  partner = params.has("partner"),
  preview = params.has("preview")
const item: SelectionDecisionItem = {
  id: "faucet",
  spec,
  currentSpec: spec,
  revision: 1,
  published: !params.has("unpublished"),
  current: true,
  decisionDueDate: partner ? null : "2026-10-01",
  allowanceCents: partner ? null : 250000,
  quotedCents: partner ? null : 250000,
  scheduleImpact: partner
    ? null
    : "Six-week lead time. No change to your completion date.",
  ownerNote: partner ? null : "Price includes delivery and installation.",
  requiresChangeOrder: false,
  changeOrderId: null,
  approvedAt: null,
  approvedByName: null,
  approvalBlocker: partner
    ? "Already approved"
    : params.has("request")
      ? "Your team must resolve the outstanding request before approval."
      : null,
  status: partner ? "ordered" : "selected",
  selectionUpdatedAt: "2026-09-05T12:00:00Z",
  history: [],
  links: [],
  requests: params.has("request")
    ? [
        {
          id: "request-1",
          kind: "pricing",
          note: "Could we also price the polished nickel finish?",
          productUrl: null,
          requesterName: "Alex Morgan",
          status: "open",
          response: null,
          updatedAt: "2026-09-05T12:00:00Z",
          canEdit: !staff && !partner && !preview,
        },
      ]
    : [],
}
const workspace: SelectionWorkspace = {
  projectId: "cedar",
  audience: staff ? "staff" : partner ? "sub_vendor" : "owner",
  canWrite: !partner && !preview,
  items: params.has("empty")
    ? []
    : [
        item,
        {
          ...item,
          id: "lighting",
          spec: {
            ...spec,
            roomName: "Primary suite",
            name: "Bedside sconces",
            manufacturer: "Visual Comfort",
            model: "Library",
            colorFinish: "Aged iron",
          },
          currentSpec: {
            ...spec,
            roomName: "Primary suite",
            name: "Bedside sconces",
          },
          requests: [],
          allowanceCents: partner ? null : 180000,
          quotedCents: partner ? null : 180000,
        },
      ],
  changeOrders: [],
  purchaseOrders: [{ id: "po-1", label: "Kitchen fixtures PO" }],
}
const data = dashboardFixture(partner ? "sub_vendor" : "owner")
const displayWorkspace = params.has("large")
  ? {
      ...workspace,
      items: Array.from({ length: 732 }, (_, index) => ({
        ...item,
        id: `selection-${index + 1}`,
        spec: { ...spec, name: `Selection ${index + 1}` },
        currentSpec: { ...spec, name: `Selection ${index + 1}` },
      })),
    }
  : workspace
const content = (
  <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <SelectionDecisionWorkspace workspace={displayWorkspace} reportProject={staff ? undefined : { id: "proj-o-cedar", name: "Cedar House", projectNumber: "O-210" }} />
  </div>
)
const container = document.getElementById("root")
if (container)
  createRoot(container).render(
    staff ? (
      content
    ) : (
      <QuickAddProvider
        projects={data.projectOptions.map((project) => ({
          ...project,
          actions: [
            {
              action: "message",
              href: quickAddHref("message", project.id, data.audience),
            },
          ],
        }))}
      >
        <ProjectAudiencePreviewShell
          audience={data.audience}
          projectId="cedar"
          projectName={data.project.name}
          projectNumber={data.project.projectNumber}
          projectOptions={data.projectOptions}
          viewer={data.viewer}
          viewerIsInternal={preview}
          messageShortcut={null}
          activeSection="selections"
          warrantyEnabled={false}
        >
          {content}
        </ProjectAudiencePreviewShell>
      </QuickAddProvider>
    )
  )
