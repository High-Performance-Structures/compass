import { redirect } from "next/navigation"
import { IconHeartHandshake } from "@tabler/icons-react"

import { getCherishStoryArchive } from "@/app/actions/cherish-stories"
import { getCherishRecipientOptions } from "@/app/actions/cherish-recipients"
import { CherishFeedbackForm } from "@/components/cherish/cherish-feedback-form"
import { CherishStoryArchive } from "@/components/cherish/cherish-story-archive"
import { getCurrentUser } from "@/lib/auth"
import { canUseFieldDesk } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function CherishPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly story?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!canUseFieldDesk(user)) {
    redirect("/dashboard/access-restricted?action=submit%20CHERISH%20feedback")
  }
  const [params, archiveResult, recipientResult] = await Promise.all([
    searchParams,
    getCherishStoryArchive(),
    getCherishRecipientOptions(),
  ])
  const initialStoryId = typeof params.story === "string"
    ? params.story
    : null

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
      <header className="border-b pb-5">
        <div className="flex items-center gap-2">
          <IconHeartHandshake className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">
            CHERISH
          </h1>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Share recognition, celebrate a project win, and revisit the moments
          your company has cherished.
        </p>
      </header>

      <section className="py-5" aria-labelledby="share-cherish-heading">
        <h2 id="share-cherish-heading" className="text-lg font-semibold">
          Share a CHERISH
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Approved recognition becomes a story for its chosen audience for 24
          hours.
        </p>
        <div className="mt-4">
          <CherishFeedbackForm
            recipients={
              recipientResult.success
                ? recipientResult.data.filter(
                    (recipient) => recipient.id !== user?.id,
                  )
                : []
            }
          />
        </div>
      </section>

      <section
        className="border-t py-5"
        aria-labelledby="cherish-archive-heading"
      >
        <h2 id="cherish-archive-heading" className="text-lg font-semibold">
          Your archive
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Company stories and shout-outs shared just with you stay here after
          they leave the dashboard.
        </p>
        <div className="mt-4">
          {archiveResult.success ? (
            <CherishStoryArchive
              items={archiveResult.data}
              initialStoryId={initialStoryId}
            />
          ) : (
            <p
              className="border-y py-6 text-sm text-muted-foreground"
              role="status"
            >
              {archiveResult.error}
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
