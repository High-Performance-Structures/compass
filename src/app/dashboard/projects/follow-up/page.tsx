export const dynamic = "force-dynamic"

import { getProjectFollowUpQueue } from "@/app/actions/project-profile"
import { ProjectFollowUpQueue } from "@/components/projects/project-follow-up-queue"

export default async function ProjectFollowUpPage(): Promise<React.ReactElement> {
  const items = await getProjectFollowUpQueue()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <ProjectFollowUpQueue items={items} />
    </div>
  )
}
