"use client"

import * as React from "react"
import { Download, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CorrespondencePdfPreview } from "./correspondence-pdf-preview"
import { attachmentPreviewKind } from "@/lib/correspondence/attachment-preview"
import type { CorrespondenceAttachment } from "@/lib/correspondence/types"

export function CorrespondenceAttachmentRow({
  projectId,
  attachment,
}: {
  readonly projectId: string
  readonly attachment: CorrespondenceAttachment
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const href = `/api/correspondence/attachments/${encodeURIComponent(attachment.id)}?projectId=${encodeURIComponent(projectId)}`
  const previewHref = `${href}&preview=1`
  const kind = attachmentPreviewKind(attachment.contentType)
  const size =
    attachment.size < 1024 * 1024
      ? `${Math.max(1, Math.round(attachment.size / 1024))} KB`
      : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`
  if (!attachment.available)
    return (
      <li className="flex items-center gap-2 border px-3 py-2 text-sm text-muted-foreground">
        <FileText className="size-4" />
        {attachment.name}
        <span className="ml-auto">File unavailable</span>
      </li>
    )
  return (
    <li className="flex items-center gap-2 border px-3 py-2 text-sm">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
        onClick={() => {
          setFailed(false)
          setOpen(true)
        }}
        aria-label={`Preview ${attachment.name}`}
      >
        <FileText className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{attachment.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{size}</span>
      </button>
      <Button asChild variant="ghost" size="icon-sm">
        <a href={href} aria-label={`Download ${attachment.name}`}>
          <Download className="size-4" />
        </a>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="break-all pr-6">
              {attachment.name}
            </DialogTitle>
            <DialogDescription>Attachment preview · {size}</DialogDescription>
          </DialogHeader>
          <div className="min-h-40 min-w-0 flex-1 overflow-auto bg-muted/30">
            {failed ? (
              <p className="p-6 text-sm" role="alert">
                This preview could not be loaded. Try reopening it or use
                Download.
              </p>
            ) : kind === "image" ? (
              // The scoped endpoint performs the same authorization for preview and download.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewHref}
                alt={attachment.name}
                className="mx-auto max-h-[65dvh] object-contain"
                onError={() => setFailed(true)}
              />
            ) : kind === "pdf" ? (
              <CorrespondencePdfPreview
                href={previewHref}
                name={attachment.name}
              />
            ) : kind === "text" ? (
              <iframe
                title={`Preview of ${attachment.name}`}
                src={previewHref}
                className="h-[65dvh] w-full border-0"
                onError={() => setFailed(true)}
              />
            ) : kind === "video" ? (
              <video
                src={previewHref}
                controls
                className="mx-auto max-h-[65dvh]"
                onError={() => setFailed(true)}
              />
            ) : kind === "audio" ? (
              <audio
                src={previewHref}
                controls
                className="mx-auto my-8 max-w-full"
                onError={() => setFailed(true)}
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                Preview is not available for this file type. Download it to open
                in its application.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close preview
            </Button>
            <Button asChild>
              <a href={href}>
                <Download className="size-4" />
                Download
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}
