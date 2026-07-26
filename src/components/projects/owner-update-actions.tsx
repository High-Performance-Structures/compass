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
  const [publishError, setPublishError] = useState<string | null>(null)
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
    await navigator.clipboard.writeText(absoluteUpdateUrl())
    setCopied("link")
  }

  async function copyEmail(): Promise<void> {
    await navigator.clipboard.writeText(
      `Subject: ${emailSubject}\n\n${plainEmailBody()}`
    )
    setCopied("email")
  }

  async function copyHtmlEmail(): Promise<void> {
    const html = htmlEmailBody()
    const plain = `Subject: ${emailSubject}\n\n${plainEmailBody()}`

    if ("ClipboardItem" in window) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ])
      setCopied("html")
      return
    }

    await navigator.clipboard.writeText(plain)
    setCopied("email")
  }

  function printOwnerUpdate(): void {
    const selected = document.querySelector(
      `[data-owner-update-id="${updateId}"]`
    )
    if (!(selected instanceof HTMLElement)) {
      window.print()
      return
    }

    const printRoot = selected.cloneNode(true)
    if (!(printRoot instanceof HTMLElement)) {
      window.print()
      return
    }

    printRoot.setAttribute("data-owner-update-print-root", "true")
    printRoot.setAttribute("data-print-selected", "true")
    printRoot.classList.add("owner-update-print-root")

    document.body.classList.add("owner-update-printing-selected")
    document.body.appendChild(printRoot)

    const resetPrintState = (): void => {
      printRoot.remove()
      document.body.classList.remove("owner-update-printing-selected")
      window.removeEventListener("afterprint", resetPrintState)
    }

    window.addEventListener("afterprint", resetPrintState)
    window.print()
    window.setTimeout(resetPrintState, 5000)
  }

  async function publish(): Promise<void> {
    setPublishError(null)
    setIsPublishing(true)
    try {
      const result = await publishOwnerProjectUpdate(projectId, updateId)
      if (result.success) {
        window.location.reload()
        return
      }
      setPublishError(result.error)
    } catch {
      setPublishError("Unable to publish this update. Please try again.")
    } finally {
      setIsPublishing(false)
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
      <Button size="sm" onClick={printOwnerUpdate}>
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
      <Button size="sm" variant="outline" onClick={copyHtmlEmail}>
        {copied === "html" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        {copied === "html" ? "Copied" : "Copy HTML email"}
      </Button>
      {publishError !== null && (
        <p
          className="basis-full border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {publishError}
        </p>
      )}
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
