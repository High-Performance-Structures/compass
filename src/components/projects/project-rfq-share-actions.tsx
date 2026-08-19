"use client"

import * as React from "react"
import {
  IconCheck,
  IconCopy,
  IconMail,
  IconPrinter,
  IconSparkles,
} from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import {
  type ProjectRfqItem,
  updateProjectOperationStatus,
} from "@/app/actions/project-operations"
import { Button } from "@/components/ui/button"
import type { ProjectBrand } from "@/lib/project-branding"

type CopiedState = "link" | "email" | "html" | null

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function plainText(value: string | null): string {
  return value?.trim() ?? ""
}

function rfqLink(projectId: string, rfqId: string): string {
  return (
    `/preview/projects/${encodeURIComponent(projectId)}/sub-vendor/rfqs` +
    `?rfq=${encodeURIComponent(rfqId)}#rfq-${encodeURIComponent(rfqId)}`
  )
}

function rfqRows(rfq: ProjectRfqItem): string {
  return rfq.scopeItems
    .map(
      (line) => `
        <tr>
          <td>${line.lineNumber}</td>
          <td>${escapeHtml(line.description)}</td>
          <td>${escapeHtml(plainText(line.phaseCode))}</td>
          <td>${escapeHtml(plainText(line.costCode))}</td>
          <td>${escapeHtml(plainText(line.notes))}</td>
        </tr>`
    )
    .join("")
}

function documentRows(rfq: ProjectRfqItem): string {
  return rfq.documentLinks
    .map(
      (link) => `
        <li>
          <a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>
          ${link.notes ? `<span>${escapeHtml(link.notes)}</span>` : ""}
        </li>`
    )
    .join("")
}

function printHtml({
  brand,
  projectLabel,
  rfq,
  url,
}: {
  readonly brand: ProjectBrand
  readonly projectLabel: string
  readonly rfq: ProjectRfqItem
  readonly url: string
}): string {
  return `
    <article class="rfq-printable">
      <header class="rfq-print-header">
        <div class="rfq-print-brand">
          <img src="${escapeHtml(brand.logoSrc)}" alt="${escapeHtml(brand.logoAlt)}" />
          <div>
            <p>${escapeHtml(brand.companyName)}</p>
            <h1>${escapeHtml(rfq.title)}</h1>
          </div>
        </div>
        <div>
          <p>${escapeHtml(projectLabel)}</p>
          <span>${escapeHtml(rfq.sourceRecordNumber ?? "RFQ")}</span>
        </div>
      </header>
      <section class="rfq-print-meta">
        <p><strong>Requested from:</strong> ${escapeHtml(
          plainText(rfq.companyName)
        )}</p>
        <p><strong>Trade/category:</strong> ${escapeHtml(
          plainText(rfq.vendorCategory)
        )}</p>
        <p><strong>Response needed by:</strong> ${escapeHtml(
          plainText(rfq.dueDate)
        )}</p>
        <p><strong>Open in Compass:</strong> <a href="${escapeHtml(url)}">${escapeHtml(
          url
        )}</a></p>
      </section>
      ${
        rfq.description
          ? `<section class="rfq-print-scope"><h2>Overall scope</h2><p>${escapeHtml(
              rfq.description
            )}</p></section>`
          : ""
      }
      <section class="rfq-print-scope">
        <h2>Scope rows</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th>Phase</th>
              <th>Cost code</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${rfqRows(rfq)}</tbody>
        </table>
      </section>
      ${
        rfq.documentLinks.length > 0
          ? `<section class="rfq-print-docs"><h2>Plans & specs package</h2><ul>${documentRows(
              rfq
            )}</ul></section>`
          : ""
      }
    </article>`.trim()
}

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
    if (rfq.status !== "draft") return true
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

  function printRfq(): void {
    const printRoot = document.createElement("article")
    printRoot.setAttribute("data-rfq-print-root", "true")
    printRoot.innerHTML = printHtml({
      brand,
      projectLabel,
      rfq,
      url: absoluteUrl(),
    })
    document.body.classList.add("rfq-printing-selected")
    document.body.appendChild(printRoot)

    const resetPrintState = (): void => {
      printRoot.remove()
      document.body.classList.remove("rfq-printing-selected")
      window.removeEventListener("afterprint", resetPrintState)
    }

    window.addEventListener("afterprint", resetPrintState)
    window.print()
    window.setTimeout(resetPrintState, 5000)
  }

  return (
    <div className="flex flex-wrap gap-1">
      <Button type="button" variant="outline" size="sm" onClick={printRfq}>
        <IconPrinter className="size-4" />
        PDF
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={copyLink} disabled={requiresTemplateReview}>
        {copied === "link" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconCopy className="size-4" />
        )}
        Link
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={copyEmail} disabled={requiresTemplateReview}>
        {copied === "email" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconMail className="size-4" />
        )}
        Email
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={copyHtmlEmail} disabled={requiresTemplateReview}>
        {copied === "html" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        HTML
      </Button>
      {shareError && (
        <span role="alert" className="basis-full text-xs text-destructive">
          {shareError}
        </span>
      )}
    </div>
  )
}
