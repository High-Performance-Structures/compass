import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { IconArrowLeft, IconBook2 } from "@tabler/icons-react"

import { HelpArticle } from "@/components/help/help-article"
import { getCurrentUser } from "@/lib/auth"
import { getHelpGuide } from "@/lib/help"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"

export const dynamic = "force-dynamic"

function reviewedDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export default async function HelpGuidePage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>
}): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  const helpAccess = await getEffectiveHelpGuideAccess(user)

  if (!helpAccess.canViewHelp) {
    redirect("/dashboard/access-restricted?feature=help-resources&action=view")
  }

  const { slug } = await params
  const guide = getHelpGuide(slug)
  if (!guide) notFound()
  if (!helpAccess.allowedGuideIds.includes(guide.id)) notFound()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-7">
      <Link
        href="/dashboard/help"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        Help &amp; Resources
      </Link>

      <header className="mt-5 border-b border-border pb-6">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
            <IconBook2 className="size-4" />
            {guide.category}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal text-foreground">
            {guide.title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            {guide.summary}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {guide.readingMinutes} minute read · Reviewed {reviewedDate(guide.lastReviewed)}
          </p>
        </div>
      </header>

      <HelpArticle
        guideId={guide.id}
        title={guide.title}
        content={guide.content}
        sections={guide.sections}
      />
    </div>
  )
}
