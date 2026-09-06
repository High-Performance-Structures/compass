export const dynamic = "force-dynamic"

import Link from "next/link"
import { getProjectMessageHistory } from "@/app/actions/project-message-history"
import { ProjectMessageHistory } from "@/components/correspondence/project-message-history"
import { decodeProjectRouteId } from "@/lib/project-route-id"

export default async function ProjectMessageHistoryPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  const projectId = decodeProjectRouteId(id)
  const result = await getProjectMessageHistory(projectId)
  if (!result.success)
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">
            Project history is unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{result.error}</p>
          <Link
            className="mt-4 inline-block underline"
            href={`/dashboard/projects/${encodeURIComponent(projectId)}/messages`}
          >
            Back to messages
          </Link>
        </div>
      </main>
    )
  return (
    <ProjectMessageHistory
      key={projectId}
      projectId={projectId}
      initialPage={result.data}
    />
  )
}
