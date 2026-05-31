"use client"

import { useState } from "react"
import {
  IconCheck,
  IconCopy,
  IconMail,
  IconPrinter,
  IconSend,
} from "@tabler/icons-react"

import { publishOwnerProjectUpdate } from "@/app/actions/project-field"
import { Button } from "@/components/ui/button"

export function OwnerUpdateActions({
  projectId,
  updateId,
  status,
  emailSubject,
  emailBody,
}: {
  readonly projectId: string
  readonly updateId: string
  readonly status: string
  readonly emailSubject: string
  readonly emailBody: string
}): React.ReactElement {
  const [isPublishing, setIsPublishing] = useState(false)
  const [copied, setCopied] = useState<"link" | "email" | null>(null)

  async function copyLink(): Promise<void> {
    await navigator.clipboard.writeText(window.location.href)
    setCopied("link")
  }

  async function copyEmail(): Promise<void> {
    await navigator.clipboard.writeText(
      `Subject: ${emailSubject}\n\n${emailBody}`
    )
    setCopied("email")
  }

  async function publish(): Promise<void> {
    setIsPublishing(true)
    const result = await publishOwnerProjectUpdate(projectId, updateId)
    setIsPublishing(false)
    if (result.success) {
      window.location.reload()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {status !== "published" && (
        <Button size="sm" onClick={publish} disabled={isPublishing}>
          <IconSend className="size-4" />
          {isPublishing ? "Publishing..." : "Publish"}
        </Button>
      )}
      <Button size="sm" onClick={() => window.print()}>
        <IconPrinter className="size-4" />
        Save PDF
      </Button>
      <Button size="sm" variant="outline" onClick={copyLink}>
        {copied === "link" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconCopy className="size-4" />
        )}
        {copied === "link" ? "Copied" : "Copy link"}
      </Button>
      <Button size="sm" variant="outline" onClick={copyEmail}>
        {copied === "email" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconMail className="size-4" />
        )}
        {copied === "email" ? "Copied" : "Copy email draft"}
      </Button>
    </div>
  )
}
