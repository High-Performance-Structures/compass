"use client"

import { IconCopy, IconMail } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  PROJECT_EMAIL_SUBJECT_TAGS,
  projectInboundEmailAddress,
} from "@/lib/email/project-address"
import { cn } from "@/lib/utils"

export function ProjectEmailAddressCard({
  projectId,
  compact = false,
}: {
  readonly projectId: string
  readonly compact?: boolean
}): React.ReactElement {
  const address = projectInboundEmailAddress(projectId)

  async function copyAddress(): Promise<void> {
    try {
      await navigator.clipboard.writeText(address)
      toast.success("Project email address copied")
    } catch {
      toast.error("Unable to copy the project email address")
    }
  }

  return (
    <section
      className={cn(
        "border-y bg-background/70 py-3",
        compact ? "px-0" : "px-3 sm:px-4"
      )}
      aria-label="Project email address"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconMail className="size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Email this project
            </p>
          </div>
          <a
            href={`mailto:${address}`}
            className="mt-1 block break-all text-sm font-medium text-primary hover:underline"
          >
            {address}
          </a>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copyAddress}>
          <IconCopy className="size-4" />
          Copy
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Start the subject with one of these tags to route the email:
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {PROJECT_EMAIL_SUBJECT_TAGS.map((item) => (
          <span key={item.tag}>
            <span className="font-mono font-medium">{item.tag}</span>{" "}
            <span className="text-muted-foreground">{item.destination}</span>
          </span>
        ))}
      </div>
    </section>
  )
}
