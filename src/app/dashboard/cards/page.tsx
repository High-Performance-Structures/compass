import type * as React from "react"
import { redirect } from "next/navigation"
import { IconMail } from "@tabler/icons-react"

import { getGreetingCardRequests } from "@/app/actions/greeting-cards"
import { GreetingCardWorkspace } from "@/components/cards/greeting-card-workspace"
import { getCurrentUser } from "@/lib/auth"
import {
  canApproveGreetingCards,
  canPrepareGreetingCards,
} from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function GreetingCardsPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  const canApprove = canApproveGreetingCards(user)
  if (!canPrepareGreetingCards(user) && !canApprove) {
    redirect("/dashboard/access-restricted?action=prepare%20greeting%20cards")
  }
  const requests = await getGreetingCardRequests()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <header className="border-b pb-5">
        <div className="flex items-center gap-2">
          <IconMail className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Greeting Cards
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Prepare handwritten cards for clients, subcontractors, vendors,
          employees, and other business relationships. Every physical mailing
          requires Executive Admin approval and a separate release action.
        </p>
      </header>

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
