import { notFound } from "next/navigation"

import { getCurrentUser } from "@/lib/auth"
import { canUseAskCompass, canUseFieldDesk } from "@/lib/permissions"
import { FieldDesk } from "@/components/field/field-desk"

export default async function FieldDeskPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (
    !user?.organizationId ||
    !canUseFieldDesk(user) ||
    !canUseAskCompass(user)
  ) {
    notFound()
  }

  return (
    <FieldDesk
      offlineScopeKey={`${user.organizationId}:${user.id}`}
      displayName={user.displayName ?? user.firstName ?? "Team member"}
    />
  )
}
