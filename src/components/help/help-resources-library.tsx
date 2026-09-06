"use client"

import * as React from "react"
import Link from "next/link"
import { IconArrowRight, IconBook2, IconSearch } from "@tabler/icons-react"

import {
  searchAllowedHelpGuides,
  type HelpGuidePreview,
} from "@/components/help/help-ui-model"
import { Input } from "@/components/ui/input"

export type HelpGuideSummary = HelpGuidePreview

type HelpGuideListItem = Readonly<{
  slug: string
  title: string
  summary: string
  category: string
  readingMinutes: number
  href: string
}>

function groupedGuides(
  guides: readonly HelpGuideListItem[],
): ReadonlyArray<Readonly<{ category: string; guides: readonly HelpGuideListItem[] }>> {
  const categories = Array.from(new Set(guides.map((guide) => guide.category)))
  return categories.map((category) => ({
    category,
    guides: guides.filter((guide) => guide.category === category),
  }))
}

export function HelpResourcesLibrary({
  guides,
}: {
  readonly guides: readonly HelpGuideSummary[]
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const shownGuides = React.useMemo(
    () =>
      query.trim().length > 0
        ? searchAllowedHelpGuides(guides, query).map((result) => ({
              slug: result.guide.slug,
              title: result.guide.title,
              summary: result.guide.summary,
              category: result.guide.category,
              readingMinutes: result.guide.readingMinutes,
              href: result.href,
            }))
        : guides.map((guide) => ({
            ...guide,
            href: `/dashboard/help/${guide.slug}`,
          })),
    [guides, query],
  )
  const groups = React.useMemo(() => groupedGuides(shownGuides), [shownGuides])
  const hasQuery = query.trim().length > 0

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-7">
      <header className="border-b border-border pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
              <IconBook2 className="size-4" />
              Compass user guide
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground">
              Help &amp; Resources
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
              Find the official explanation for Compass tools and workflows.
              Search by a task, page, button, or term you see on screen.
            </p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the user guide"
              aria-label="Search the Compass user guide"
              className="h-10 bg-background pl-9"
              autoComplete="off"
            />
          </div>
        </div>
      </header>

      <div className="flex items-center justify-between border-b border-border py-3">
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {hasQuery
            ? `${shownGuides.length} matching ${shownGuides.length === 1 ? "guide" : "guides"}`
            : `${guides.length} ${guides.length === 1 ? "guide" : "guides"}`}
        </p>
        {hasQuery ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear search
          </button>
        ) : null}
      </div>

      {shownGuides.length === 0 ? (
        <section className="border-b border-border py-12 text-center">
          <IconSearch className="mx-auto size-7 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">No matching guide</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try the name of a tool, workflow, button, or document.
          </p>
        </section>
      ) : (
        groups.map((group) => (
          <section
            key={group.category}
            className="grid border-b border-border py-5 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-6"
          >
            <h2 className="mb-3 text-sm font-semibold text-foreground md:mb-0">
              {group.category}
            </h2>
            <div className="divide-y divide-border">
              {group.guides.map((guide) => (
                <Link
                  key={guide.slug}
                  href={guide.href}
                  className="group grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
                >
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground transition-colors group-hover:text-primary">
                      {guide.title}
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                      {guide.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{guide.readingMinutes} min</span>
                    <IconArrowRight className="size-4 transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
