import { notFound } from "next/navigation"

import { getActiveCherishStories } from "@/app/actions/cherish-stories"
import { FieldDesk } from "@/components/field/field-desk"
import { getCurrentUser } from "@/lib/auth"
import { canUseAskCompass, canUseFieldDesk } from "@/lib/permissions"

export default async function FieldDeskPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (
    !user?.organizationId ||
    !canUseFieldDesk(user) ||
    !canUseAskCompass(user)
  ) {
    notFound()
  }

  const cherishResult = await getActiveCherishStories()

  return (
    <FieldDesk
      offlineScopeKey={`${user.organizationId}:${user.id}`}
      displayName={user.displayName ?? user.firstName ?? "Team member"}
      cherishRecognitions={
        cherishResult.success
          ? cherishResult.data
          : []
      }
    />
  )
}
