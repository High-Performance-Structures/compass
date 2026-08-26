"use client"

import { IconCopy, IconMail, IconMessageCircle } from "@tabler/icons-react"
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

function formattedPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return value
}

function ProjectTextAddressCard({
  phoneNumber,
  projectNumber,
  compact,
}: {
  readonly phoneNumber: string
  readonly projectNumber: string | null
  readonly compact: boolean
}): React.ReactElement {
  const starter = projectNumber ? `${projectNumber} ` : ""

  async function copyNumber(): Promise<void> {
    try {
      await navigator.clipboard.writeText(phoneNumber)
      toast.success("Project text number copied")
    } catch {
      toast.error("Unable to copy the project text number")
    }
  }

  return (
    <section
      className={cn(
        "border-b bg-background/70 py-3",
        compact ? "px-0" : "px-3 sm:px-4"
      )}
      aria-label="Project text number"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconMessageCircle className="size-4 shrink-0 text-muted-foreground" />
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Text this project
            </p>
          </div>
          <a
            href={`sms:${phoneNumber}?body=${encodeURIComponent(starter)}`}
            className="mt-1 block text-sm font-medium text-primary hover:underline"
          >
            {formattedPhoneNumber(phoneNumber)}
          </a>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={copyNumber}>
          <IconCopy className="size-4" />
          Copy
        </Button>
      </div>
      {projectNumber ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Start every new text with <span className="font-mono font-medium text-foreground">{projectNumber}</span>{" "}
          so Compass can attach the message and photos to this project. Add an optional routing tag after the project number:
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Send from a phone number saved in this project&apos;s contacts. Until a project number is assigned, Compass sends unmatched or ambiguous texts to staff for review.
        </p>
      )}
      {projectNumber && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {PROJECT_EMAIL_SUBJECT_TAGS.map((item) => (
            <span key={item.tag}>
              <span className="font-mono font-medium">{item.tag}</span>{" "}
              <span className="text-muted-foreground">{item.destination}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

export function ProjectCommunicationInstructions({
  projectId,
  projectNumber,
  textPhoneNumber,
  compact = false,
}: {
  readonly projectId: string
  readonly projectNumber: string | null
  readonly textPhoneNumber: string
  readonly compact?: boolean
}): React.ReactElement {
  return (
    <div>
      <ProjectEmailAddressCard projectId={projectId} compact={compact} />
      <ProjectTextAddressCard
        phoneNumber={textPhoneNumber}
        projectNumber={projectNumber}
        compact={compact}
      />
    </div>
  )
}
