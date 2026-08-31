import { decodeProjectRouteId } from "@/lib/project-route-id"
import { redirect } from "next/navigation"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"

export default async function SubVendorPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  redirect(projectAudiencePreviewHref(id, "sub-vendor"))
}
