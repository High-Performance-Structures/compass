import type * as React from "react"
import { redirect } from "next/navigation"
import { IconMail } from "@tabler/icons-react"

import { getGreetingCardRequests } from "@/app/actions/greeting-cards"
import { GreetingCardWorkspace } from "@/components/cards/greeting-card-workspace"
import { getCurrentUser } from "@/lib/auth"
import {
  canPrepareGreetingCards,
} from "@/lib/permissions"
import { canFeature } from "@/lib/permission-enforcement"
import { PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function GreetingCardsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  const canViewApprovals = await canFeature(user, "greeting-card-approval", "read")
  const canApprove = await canFeature(user, "greeting-card-approval", "approve")
  if (!canPrepareGreetingCards(user) && !canViewApprovals) {
    redirect("/dashboard/access-restricted?action=prepare%20greeting%20cards")
  }
  const requests = await getGreetingCardRequests()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <PageHeader
        className="mb-0 border-b pb-5"
        icon={<IconMail className="size-6 text-primary" />}
        title="Greeting Cards"
      />

      <section className="py-5" aria-label="Greeting-card requests">
        {requests.success ? (
          <GreetingCardWorkspace
            initialRequests={requests.data}
            canApprove={canApprove}
          />
        ) : (
          <p className="border-y py-6 text-sm text-destructive" role="status">
            {requests.error}
          </p>
        )}
      </section>
    </main>
  )
}
