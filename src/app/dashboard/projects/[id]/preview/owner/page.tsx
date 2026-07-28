import { redirect } from "next/navigation"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"

export default async function OwnerPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<never> {
  const { id } = await params
  redirect(projectAudiencePreviewHref(id, "owner"))
}
