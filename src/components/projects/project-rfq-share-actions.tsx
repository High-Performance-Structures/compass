"use client"

import * as React from "react"
import {
  IconCheck,
  IconCopy,
  IconMail,
  IconSparkles,
} from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import type { ProjectRfqItem } from "@/lib/domain/operations/types"
import { updateProjectOperationStatus } from "@/app/actions/project-operations"
import { PrintPreviewButton } from "@/components/print/print-preview-button"
import { Button } from "@/components/ui/button"
import type { ProjectBrand } from "@/lib/project-branding"
import { escapeHtml, rfqLink } from "@/lib/print/rfq-print"

type CopiedState = "link" | "email" | "html" | null

export function ProjectRfqShareActions({
  brand,
  projectId,
  projectLabel,
  rfq,
}: {
  readonly brand: ProjectBrand
  readonly projectId: string
  readonly projectLabel: string
  readonly rfq: ProjectRfqItem
}): React.ReactElement {
  const router = useRouter()
  const [copied, setCopied] = React.useState<CopiedState>(null)
  const [shareError, setShareError] = React.useState<string | null>(null)
  const requiresTemplateReview = rfq.templateReview !== null

  async function prepareForSharing(): Promise<boolean> {
    setShareError(null)
    if (!rfq.actions.sharingMarksSent) return true
    const result = await updateProjectOperationStatus(
      projectId,
      rfq.id,
      "rfq",
      "sent"
    )
    if (!result.success) {
      setShareError(result.error)
      return false
    }
    router.refresh()
    return true
  }

  React.useEffect(() => {
    const logo = new window.Image()
    logo.decoding = "sync"
    logo.src = brand.logoSrc
  }, [brand.logoSrc])

  function absoluteUrl(): string {
    return new URL(rfqLink(projectId, rfq.id), window.location.origin).toString()
  }

  function plainEmail(): string {
    return [
      `Subject: ${rfq.sourceRecordNumber ?? "RFQ"} - ${rfq.title}`,
      "",
      `Request for quote: ${rfq.title}`,
      projectLabel,
      rfq.companyName ? `Requested from: ${rfq.companyName}` : "",
      rfq.dueDate ? `Response needed by: ${rfq.dueDate}` : "",
      "",
      rfq.description ?? "",
      "",
      "Open RFQ:",
      absoluteUrl(),
      "",
      brand.companyName,
      ...brand.contactLines,
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  }

  function htmlEmail(): string {
    const rows = rfq.scopeItems
      .slice(0, 12)
      .map(
        (line) =>
          `<li><strong>${escapeHtml(line.description)}</strong>${
            line.costCode ? ` - ${escapeHtml(line.costCode)}` : ""
          }</li>`
      )
      .join("")

    return `
      <div style="font-family:Arial,sans-serif;color:#1f2933;line-height:1.5;max-width:760px;">
        <p style="margin:0 0 8px 0;color:#6b7280;">Request for Quote</p>
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#111827;">${escapeHtml(
          rfq.title
        )}</h2>
        <p style="margin:0 0 14px 0;color:#374151;">${escapeHtml(
          projectLabel
        )}</p>
        ${
          rfq.description
            ? `<p style="margin:0 0 14px 0;color:#374151;">${escapeHtml(
                rfq.description
              )}</p>`
            : ""
        }
        <ul style="margin:0 0 18px 20px;padding:0;color:#374151;font-size:14px;">${rows}</ul>
        <a href="${absoluteUrl()}" style="display:inline-block;background:#3f7d4d;color:#ffffff;text-decoration:none;border-radius:6px;padding:10px 16px;font-weight:700;">Open RFQ</a>
        <div style="margin-top:20px;border-top:1px solid #d1d5db;padding-top:12px;font-size:12px;color:#6b7280;">
          <strong>${escapeHtml(brand.companyName)}</strong><br>
          ${brand.contactLines.map((line) => escapeHtml(line)).join("<br>")}
        </div>
      </div>`.trim()
  }

  async function copyLink(): Promise<void> {
    if (!(await prepareForSharing())) return
    await navigator.clipboard.writeText(absoluteUrl())
    setCopied("link")
  }

  async function copyEmail(): Promise<void> {
    if (!(await prepareForSharing())) return
    await navigator.clipboard.writeText(plainEmail())
    setCopied("email")
  }

  async function copyHtmlEmail(): Promise<void> {
    if (!(await prepareForSharing())) return
    const html = htmlEmail()
    const plain = plainEmail()
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

  return (
    <div className="flex flex-wrap gap-1">
      <PrintPreviewButton
        link={{ projectId, document: "rfq", params: { rfqId: rfq.id }, number: rfq.sourceRecordNumber ?? "RFQ" }}
      />
      <Button type="button" variant="outline" size="sm" onClick={copyLink} disabled={requiresTemplateReview}>
        {copied === "link" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconCopy className="size-4" />
        )}
        Copy portal link
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={copyEmail} disabled={requiresTemplateReview}>
        {copied === "email" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconMail className="size-4" />
        )}
        Copy email
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={copyHtmlEmail} disabled={requiresTemplateReview}>
        {copied === "html" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        Copy HTML
      </Button>
      {shareError && (
        <span role="alert" className="basis-full text-xs text-destructive">
          {shareError}
        </span>
      )}
    </div>
  )
}
