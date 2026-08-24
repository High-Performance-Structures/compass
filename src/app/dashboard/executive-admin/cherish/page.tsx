import type * as React from "react"
import { redirect } from "next/navigation"
import { IconHeartHandshake, IconLock } from "@tabler/icons-react"

import { CherishPulseStream } from "@/components/dashboard/cherish-pulse-stream"
import { getCurrentUser } from "@/lib/auth"
import { canUseExecutiveAdmin } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function CherishReviewPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!canUseExecutiveAdmin(user)) {
    redirect("/dashboard/access-restricted?action=review%20CHERISH")
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <header className="border-b pb-5">
        <div className="flex items-center gap-2">
          <IconHeartHandshake className="size-5 text-[var(--department-primary)]" />
          <h1 className="text-2xl font-semibold tracking-tight">
            CHERISH review
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Approve shout-outs and project wins for the team stream, acknowledge
          private concerns, or archive submissions that should not be shared.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <IconLock className="size-3.5" /> Executive Admin only
        </p>
      </header>

      <section className="py-5" aria-label="CHERISH review queue">
        <CherishPulseStream canReview refreshKey={0} />
      </section>
    </main>
  )
}
