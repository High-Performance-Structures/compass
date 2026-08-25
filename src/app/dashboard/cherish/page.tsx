import { redirect } from "next/navigation"
import { IconHeartHandshake } from "@tabler/icons-react"

import { CherishFeedbackForm } from "@/components/cherish/cherish-feedback-form"
import { getCurrentUser } from "@/lib/auth"
import { canUseFieldDesk } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function CherishPage(): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!canUseFieldDesk(user)) {
    redirect("/dashboard/access-restricted?action=submit%20CHERISH%20feedback")
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <header className="border-b pb-5">
        <div className="flex items-center gap-2">
          <IconHeartHandshake className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            CHERISH feedback
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Recognize a teammate, celebrate a project win, or privately let
          leadership know where support is needed.
        </p>
      </header>

      <section className="py-5" aria-label="Submit CHERISH feedback">
        <CherishFeedbackForm />
      </section>
    </main>
  )
}
