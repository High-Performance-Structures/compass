import { decodeProjectRouteId } from "@/lib/project-route-id"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"
import { ClientRedirect } from "@/components/client-redirect"

export default async function SubVendorPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  return <ClientRedirect href={projectAudiencePreviewHref(id, "sub-vendor")} />
}
