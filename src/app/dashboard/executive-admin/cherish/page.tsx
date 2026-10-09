import type * as React from "react"
import { redirect } from "next/navigation"
import { IconHeartHandshake, IconLock } from "@tabler/icons-react"

import { CherishPulseStream } from "@/components/dashboard/cherish-pulse-stream"
import { getCurrentUser } from "@/lib/auth"
import { canFeature } from "@/lib/permission-enforcement"
import { PageHeader } from "@/components/page-header"

export const dynamic = "force-dynamic"

export default async function CherishReviewPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!(await canFeature(user, "cherish-review", "read"))) {
    redirect("/dashboard/access-restricted?action=review%20CHERISH")
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <PageHeader
        className="mb-0 border-b pb-5"
        icon={<IconHeartHandshake className="size-5 text-[var(--department-primary)]" />}
        title="CHERISH review"
        meta={
          <span className="flex items-center gap-1.5">
            <IconLock className="size-3.5" /> Restricted to staff granted CHERISH review access
          </span>
        }
      />

      <section className="py-5" aria-label="CHERISH review queue">
        <CherishPulseStream canReview refreshKey={0} />
      </section>
    </main>
  )
}
