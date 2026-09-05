import type * as React from "react"
import { requireProjectRouteId } from "@/lib/project-route-id"
import { AudienceSelectionPage } from "@/components/selections/audience-selection-page"
export const dynamic = "force-dynamic"
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  return (
    <AudienceSelectionPage
      projectId={await requireProjectRouteId(id)}
      audience="sub_vendor"
    />
  )
}
