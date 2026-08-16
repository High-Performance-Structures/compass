import { redirect } from "next/navigation"

import { listStaffBoardPosts } from "@/app/actions/staff-board"
import { StaffBoardView } from "@/components/staff-board-view"
import { can } from "@/lib/permissions"
import { canAccessStaffBoard, hasActiveStaffBoardOrganization } from "@/lib/staff-board"
import { getCurrentUser } from "@/lib/auth"

export default async function StaffBoardPage(): Promise<React.ReactNode> {
  const user = await getCurrentUser()
  if (
    !user ||
    !canAccessStaffBoard(user.role, user.isActive, user.organizationType) ||
    !(await hasActiveStaffBoardOrganization(user))
  ) {
    redirect("/dashboard/access-restricted")
  }

  const result = await listStaffBoardPosts()
  if (!result.success) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-destructive">
        {result.error}
      </div>
    )
  }

  return (
    <StaffBoardView
      initialPosts={result.data}
      currentUserId={user.id}
      canModerate={can(user, "channels", "moderate")}
    />
  )
}
