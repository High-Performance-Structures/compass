"use client"

import type * as React from "react"
import Link from "next/link"
import { IconArrowRight } from "@tabler/icons-react"
import {
  PortfolioJobMessageList,
  type PortfolioJobMessages,
} from "@/components/dashboard/portfolio-map/portfolio-job-messages"

export type AudiencePanelItem = {
  readonly id: string
  readonly title: string
  readonly when: string
}

export type AudiencePanelLink = {
  readonly label: string
  readonly href: string
}

/**
 * The right-hand panel on owner and sub/vendor maps: unread messages for the
 * job, what's next, the latest update, and links into the sections this
 * workspace can open. Callers pass only what the viewer may see.
 */
export function AudienceJobPanel({
  heading,
  stage,
  messages,
  messagesTitle,
  upcoming,
  upcomingEmpty,
  latest,
  links,
}: {
  readonly heading: React.ReactNode
  /** Stage/progress block (owner stepper) or phase line (vendor). */
  readonly stage?: React.ReactNode
  readonly messages: PortfolioJobMessages | null
  readonly messagesTitle?: string
  /** Null while loading. */
  readonly upcoming: readonly AudiencePanelItem[] | null
  readonly upcomingEmpty: string
  readonly latest?: { readonly label: string; readonly title: string; readonly href: string } | null
  readonly links: readonly AudiencePanelLink[]
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 p-5">
      {heading}
      {stage}
      {messages ? <PortfolioJobMessageList messages={messages} title={messagesTitle} /> : null}
      <section aria-label="Coming up">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coming up</h3>
        {upcoming === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{upcomingEmpty}</p>
        ) : (
          <ul className="mt-2 divide-y border-y text-sm">
            {upcoming.map((item) => (
              <li key={item.id} className="flex min-w-0 justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{item.when}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {latest ? (
        <section aria-label={latest.label}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{latest.label}</h3>
          <Link href={latest.href} className="mt-2 block text-sm hover:text-primary">
            {latest.title} <span className="text-primary">→</span>
          </Link>
        </section>
      ) : null}
      {links.length > 0 ? (
        <nav aria-label="Go to" className="flex flex-col">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Go to</h3>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center justify-between gap-2 border-t py-2 text-sm hover:text-primary"
            >
              {link.label}
              <IconArrowRight className="size-3.5 text-primary" aria-hidden="true" />
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  )
}
