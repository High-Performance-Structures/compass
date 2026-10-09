import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { IconArrowLeft, IconBook2 } from "@tabler/icons-react"

import { HelpArticle } from "@/components/help/help-article"
import { CloseHelpButton } from "@/components/help/close-help-button"
import {
  helpHrefWithReturnTo,
  safeHelpReturnTo,
} from "@/components/help/help-ui-model"
import { getCurrentUser } from "@/lib/auth"
import { getHelpGuide } from "@/lib/help"
import { getEffectiveHelpGuideAccess } from "@/lib/help/server-access"
import { PageHeader } from "@/components/page-header"

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
  searchParams,
}: {
  readonly params: Promise<{ readonly slug: string }>
  readonly searchParams: Promise<{ readonly returnTo?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  const helpAccess = await getEffectiveHelpGuideAccess(user)

  if (!helpAccess.canViewHelp) {
    redirect("/dashboard/access-restricted?feature=help-resources&action=view")
  }

  const { slug } = await params
  const { returnTo: rawReturnTo } = await searchParams
  const returnTo = safeHelpReturnTo(
    typeof rawReturnTo === "string" ? rawReturnTo : undefined,
  )
  const guide = getHelpGuide(slug)
  if (!guide) notFound()
  if (!helpAccess.allowedGuideIds.includes(guide.id)) notFound()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-7">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={
            returnTo
              ? helpHrefWithReturnTo("/dashboard/help", returnTo)
              : "/dashboard/help"
          }
          className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          Help &amp; Resources
        </Link>
        <CloseHelpButton returnTo={returnTo ?? undefined} />
      </div>

      <header className="mt-5 border-b border-border pb-6">
        <PageHeader
          className="mb-0 max-w-3xl"
          eyebrow={guide.category}
          icon={<IconBook2 className="size-5 text-primary" />}
          title={guide.title}
          meta={`${guide.readingMinutes} minute read · Reviewed ${reviewedDate(guide.lastReviewed)}`}
        />
        {/* The summary is the article's opening paragraph, not a header line. */}
        <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
          {guide.summary}
        </p>
      </header>

      <HelpArticle
        guideId={guide.id}
        title={guide.title}
        content={guide.content}
        sections={guide.sections}
        returnTo={returnTo}
      />
    </div>
  )
}
