"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  IconCheck,
  IconCopy,
  IconMail,
  IconPrinter,
  IconRefresh,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react"

import {
  deleteOwnerProjectUpdateDraft,
  recallOwnerProjectUpdate,
} from "@/app/actions/project-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

const PRINT_IMAGE_TIMEOUT_MS = 3_000

async function waitForPrintableImage(
  image: HTMLImageElement
): Promise<void> {
  if (image.complete) {
    if (image.naturalWidth > 0) {
      try {
        await image.decode()
      } catch {
        // A decoded resource can still be available to the browser's print
        // renderer even when decode() rejects for a cached image.
      }
    }
    return
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      image.removeEventListener("load", finish)
      image.removeEventListener("error", finish)
      resolve()
    }
    const timeoutId = window.setTimeout(finish, PRINT_IMAGE_TIMEOUT_MS)

    image.addEventListener("load", finish, { once: true })
    image.addEventListener("error", finish, { once: true })
  })
}

async function waitForPrintLayout(root: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(root.querySelectorAll("img")).map(waitForPrintableImage)
  )

  // Give the cloned print tree two layout frames after its image dimensions
  // settle so PNG logos are present when the print snapshot is captured.
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

export function OwnerUpdateActions({
  canManage,
  projectId,
  updateId,
  status,
  emailSubject,
  emailPreview,
  updatePath,
  projectLabel,
  updateTitle,
}: {
  readonly canManage: boolean
  readonly projectId: string
  readonly updateId: string
  readonly status: string
  readonly emailSubject: string
  readonly emailPreview: string
  readonly updatePath: string
  readonly projectLabel: string
  readonly updateTitle: string
}): React.ReactElement {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRecalling, setIsRecalling] = useState(false)
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

  async function printOwnerUpdate(): Promise<void> {
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
    await waitForPrintLayout(printRoot)
    window.print()
    window.setTimeout(resetPrintState, 5000)
  }

  async function deleteDraft(): Promise<void> {
    const confirmed = window.confirm(
      "Delete this owner update draft? This cannot be undone."
    )
    if (!confirmed) return

    setPublishError(null)
    setIsDeleting(true)
    try {
      const result = await deleteOwnerProjectUpdateDraft(projectId, updateId)
      if (!result.success) {
        setPublishError(result.error)
        return
      }

      router.push(`/dashboard/projects/${projectId}/owner-updates`)
      router.refresh()
    } catch {
      setPublishError("Unable to delete this draft. Please try again.")
    } finally {
      setIsDeleting(false)
    }
  }

  async function recallUpdate(): Promise<void> {
    setPublishError(null)
    setIsRecalling(true)
    try {
      const result = await recallOwnerProjectUpdate(projectId, updateId)
      if (!result.success) {
        setPublishError(result.error)
        return
      }

      window.location.reload()
    } catch {
      setPublishError("Unable to recall this update. Please try again.")
    } finally {
      setIsRecalling(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {canManage && status === "draft" && (
        <Button
          size="sm"
          variant="outline"
          onClick={deleteDraft}
          disabled={isDeleting}
        >
          <IconTrash className="size-4" />
          {isDeleting ? "Deleting..." : "Delete draft"}
        </Button>
      )}
      {canManage && status === "published" && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={isRecalling}
            >
              <IconRefresh className="size-4" />
              {isRecalling ? "Recalling..." : "Recall update"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Recall this owner update?</AlertDialogTitle>
              <AlertDialogDescription>
                The update will be hidden from the owner portal and returned to
                draft so it can be corrected. This cannot withdraw copies that
                were already emailed, downloaded, or printed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep published</AlertDialogCancel>
              <AlertDialogAction onClick={() => void recallUpdate()}>
                Recall to draft
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
      {canManage && (
        <>
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
        </>
      )}
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
