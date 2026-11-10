import type * as React from "react"

import {
  getProjectChangeOrder,
  getProjectChangeOrderFormOptions,
} from "@/app/actions/project-change-orders"
import { getProjectPaperTrail } from "@/app/actions/paper-trail"
import { getProjectVarianceOptions } from "@/app/actions/project-variances"
import { getSageChangeOrderSendState } from "@/app/actions/sage-change-orders"
import { ClientRedirect } from "@/components/client-redirect"
import { SageChangeOrderSendPanel } from "@/components/financials/sage-change-order-send"
import { PaperTrailRecordStatus } from "@/components/paper-trail/paper-trail-record-status"
import { ProjectChangeOrderDetail } from "@/components/projects/project-change-order-detail"
import { permissionDeniedRedirectHref } from "@/lib/permission-redirect"

/**
 * The staff view of one change order, loaded on the server. The full page and
 * the change order list's record drawer both render it, so they show the same
 * record. Returns null when the change order isn't on this project.
 */
export async function ProjectChangeOrderStaffDetail({
  projectId,
  changeOrderId,
  backHref,
}: {
  readonly projectId: string
  readonly changeOrderId: string
  /** The full page's back link; the drawer has none. */
  readonly backHref: string | null
}): Promise<React.ReactElement | null> {
  // A permission denial sends the browser to the access page instead.
  const loaded = await Promise.all([
    getProjectChangeOrder(projectId, changeOrderId),
    getProjectChangeOrderFormOptions(projectId),
    getProjectPaperTrail(projectId, "change_order"),
    getProjectVarianceOptions(projectId),
    // Office staff with finance access only; everyone else gets no panel.
    getSageChangeOrderSendState(projectId, [changeOrderId]).catch(() => null),
  ]).then(
    (data) => ({ data, deniedHref: null }),
    (error: unknown) => {
      const deniedHref = permissionDeniedRedirectHref(error)
      if (deniedHref) return { data: null, deniedHref }
      throw error
    },
  )
  if (loaded.data === null) return <ClientRedirect href={loaded.deniedHref} />
  const [item, formOptions, paperTrail, varianceOptions, sageSend] = loaded.data
  if (!item) return null

  return (
    <ProjectChangeOrderDetail
      item={item}
      backHref={backHref}
      internal
      formOptions={formOptions}
      varianceOptions={varianceOptions}
      sagePanel={
        sageSend?.success && sageSend.data.items.length > 0 ? (
          <SageChangeOrderSendPanel projectId={projectId} state={sageSend.data} />
        ) : null
      }
      paperTrailStatus={
        paperTrail.enabled ? (
          <PaperTrailRecordStatus
            projectId={projectId}
            recordType="change_order"
            recordId={changeOrderId}
            record={paperTrail.records[changeOrderId] ?? null}
          />
        ) : null
      }
    />
  )
}
