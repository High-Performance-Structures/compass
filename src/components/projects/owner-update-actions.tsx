"use client"

import { useState } from "react"
import {
  IconCheck,
  IconCopy,
  IconMail,
  IconPrinter,
  IconSparkles,
  IconSend,
} from "@tabler/icons-react"

import { publishOwnerProjectUpdate } from "@/app/actions/project-field"
import { Button } from "@/components/ui/button"
import {
  copyHtmlToClipboard,
  copyTextToClipboard,
  showManualCopyDialog,
} from "@/lib/browser-copy"
import { printAfterDomUpdate } from "@/lib/browser-print"
import { toast } from "sonner"

export function OwnerUpdateActions({
  projectId,
  updateId,
  status,
  emailSubject,
  emailPreview,
  updatePath,
  projectLabel,
  updateTitle,
}: {
  readonly projectId: string
  readonly updateId: string
  readonly status: string
  readonly emailSubject: string
  readonly emailPreview: string
  readonly updatePath: string
  readonly projectLabel: string
  readonly updateTitle: string
}): React.ReactElement {
  const [isPublishing, setIsPublishing] = useState(false)
  const [copied, setCopied] = useState<"link" | "email" | "html" | null>(null)

  function absoluteUpdateUrl(): string {
    return new URL(updatePath, window.location.origin).toString()
  }

  function plainEmailBody(): string {
    return [
      `New project update for ${projectLabel}`,
      "",
      emailPreview,
      "",
      `View full update: ${absoluteUpdateUrl()}`,
    ].join("\n")
  }

  function htmlEmailBody(): string {
    const url = absoluteUpdateUrl()
    return `
      <div style="font-family:Arial,sans-serif;color:#1f2933;line-height:1.5;max-width:680px;">
        <p style="margin:0 0 12px 0;color:#4b5563;">Project update</p>
        <h2 style="margin:0 0 8px 0;font-size:22px;line-height:1.25;color:#111827;">${escapeHtml(updateTitle)}</h2>
        <p style="margin:0 0 18px 0;font-size:15px;color:#374151;">${escapeHtml(emailPreview)}</p>
        <a href="${url}" style="display:inline-block;background:#3f7d4d;color:#ffffff;text-decoration:none;border-radius:6px;padding:10px 16px;font-weight:700;">
          View full update
        </a>
        <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">
          ${escapeHtml(projectLabel)}
        </p>
      </div>`.trim()
  }

  async function copyLink(): Promise<void> {
    if (await copyTextToClipboard(absoluteUpdateUrl())) {
      setCopied("link")
      toast.success("Link copied")
      return
    }
    showManualCopyDialog({ title: "Copy update link", text: absoluteUpdateUrl() })
    toast.error("Your browser blocked automatic copying.")
  }

  async function copyEmail(): Promise<void> {
    if (await copyTextToClipboard(
      `Subject: ${emailSubject}\n\n${plainEmailBody()}`
    )) {
      setCopied("email")
      toast.success("Email draft copied")
      return
    }
    showManualCopyDialog({
      title: "Copy email draft",
      text: `Subject: ${emailSubject}\n\n${plainEmailBody()}`,
    })
    toast.error("Your browser blocked automatic copying.")
  }

  async function copyHtmlEmail(): Promise<void> {
    const html = htmlEmailBody()
    const plain = `Subject: ${emailSubject}\n\n${plainEmailBody()}`
    const result = await copyHtmlToClipboard({ html, plain })
    if (result === "rich") {
      setCopied("html")
      toast.success("HTML email copied")
      return
    }
    if (result === "plain") {
      setCopied("email")
      toast.success("Email draft copied as plain text")
      return
    }
    showManualCopyDialog({ title: "Copy email draft", text: plain })
    toast.error("Your browser blocked automatic copying.")
  }

  function printOwnerUpdate(): void {
    const selected = document.querySelector(
      `[data-owner-update-id="${updateId}"]`
    )
    if (!(selected instanceof HTMLElement)) {
      window.print()
      return
    }

    document.body.classList.add("owner-update-printing-selected")
    selected.setAttribute("data-owner-update-print-root", "true")
    selected.setAttribute("data-print-selected", "true")

    printAfterDomUpdate(() => {
      selected.removeAttribute("data-owner-update-print-root")
      selected.removeAttribute("data-print-selected")
      document.body.classList.remove("owner-update-printing-selected")
    })
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
        <Button type="button" size="sm" onClick={publish} disabled={isPublishing}>
          <IconSend className="size-4" />
          {isPublishing ? "Publishing..." : "Publish"}
        </Button>
      )}
      <Button type="button" size="sm" onClick={printOwnerUpdate}>
        <IconPrinter className="size-4" />
        Save PDF
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={copyLink}>
        {copied === "link" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconCopy className="size-4" />
        )}
        {copied === "link" ? "Copied" : "Copy link"}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={copyEmail}>
        {copied === "email" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconMail className="size-4" />
        )}
        {copied === "email" ? "Copied" : "Copy email draft"}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={copyHtmlEmail}>
        {copied === "html" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        {copied === "html" ? "Copied" : "Copy HTML email"}
      </Button>
    </div>
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
