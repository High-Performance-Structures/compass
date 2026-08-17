import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"

import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contacts"
import { getProjectWarrantyWorkspace } from "@/app/actions/project-warranty"
import { ProjectWarrantyWorkspace } from "@/components/projects/project-warranty-workspace"
import { Button } from "@/components/ui/button"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

export const dynamic = "force-dynamic"

export default async function ProjectWarrantyPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const [workspace, assigneeOptions] = await Promise.all([
    getProjectWarrantyWorkspace(id),
    getProjectTaskAssigneeOptions(id),
  ]).catch((error: unknown) => {
    redirectIfFeaturePermissionDenied(error)
    throw error
  })
  const assigneeNames = Array.from(
    new Set(
      [
        ...assigneeOptions.projectContacts,
        ...assigneeOptions.directoryContacts,
      ].map((option) => option.name.trim()).filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right))

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
          assigneeNames={assigneeNames}
        />
      </div>
    </main>
  )
}
