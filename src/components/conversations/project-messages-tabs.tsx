import Link from "next/link"

import { cn } from "@/lib/utils"

/** The Emails | Conversations tabs at the top of a job's Messages page. */
export function ProjectMessagesTabs({
  active,
  emailsHref,
  conversationsHref,
}: {
  readonly active: "emails" | "conversations"
  readonly emailsHref: string
  readonly conversationsHref: string
}) {
  const tabs = [
    { key: "emails", label: "Emails", href: emailsHref },
    { key: "conversations", label: "Conversations", href: conversationsHref },
  ] as const
  return (
    <nav aria-label="Message type" className="flex gap-1 border-b px-4">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            active === tab.key
              ? "border-primary font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
