import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"

import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contacts"
import { getProjectWarrantyWorkspace } from "@/app/actions/project-warranty"
import { ProjectWarrantyWorkspace } from "@/components/projects/project-warranty-workspace"
import { warrantyAssigneeOptions } from "@/lib/warranty/assignee"
import { Button } from "@/components/ui/button"
import { permissionDeniedRedirectHref } from "@/lib/permission-redirect"
import { ClientRedirect } from "@/components/client-redirect"

export const dynamic = "force-dynamic"

export default async function ProjectWarrantyPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  // A permission denial sends the browser to the access page instead.
  const loaded = await Promise.all([
    getProjectWarrantyWorkspace(id),
    getProjectTaskAssigneeOptions(id),
  ]).then(
    (data) => ({ data, deniedHref: null }),
    (error: unknown) => {
      const deniedHref = permissionDeniedRedirectHref(error)
      if (deniedHref) return { data: null, deniedHref }
      throw error
    },
  )
  if (loaded.data === null) return <ClientRedirect href={loaded.deniedHref} />
  const [workspace, assigneeOptions] = loaded.data
  const warrantyOptions = warrantyAssigneeOptions(assigneeOptions)

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link href={`/dashboard/projects/${encodeURIComponent(id)}`}>
          <IconArrowLeft className="size-4" /> Back to project
        </Link>
      </Button>
      <div className="overflow-hidden rounded-lg border">
        <ProjectWarrantyWorkspace
          workspace={workspace}
          assigneeOptions={warrantyOptions}
        />
      </div>
    </main>
  )
}
