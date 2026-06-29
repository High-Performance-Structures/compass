"use client"

import * as React from "react"
import {
  IconCheck,
  IconCopy,
  IconFileSpreadsheet,
  IconMail,
  IconPrinter,
  IconSparkles,
} from "@tabler/icons-react"

import type { ProjectSelectionsSummary } from "@/app/actions/project-selections"
import { Button } from "@/components/ui/button"
import {
  copyHtmlToClipboard,
  copyTextToClipboard,
  showManualCopyDialog,
} from "@/lib/browser-copy"
import {
  selectionPrintUrl,
  totalSelectionPrompts,
  type SelectionPrintFilters,
  type SelectionPrintMode,
} from "@/lib/project-selection-print"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

type CopiedState = "link" | "email" | "html" | "sheet" | null

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

function selectionLink(projectId: string): string {
  return `/dashboard/projects/${projectId}/selections`
}

function tsvCell(value: string | number | null): string {
  return String(value ?? "").replaceAll("\t", " ").replaceAll("\n", " ")
}

export function ProjectSelectionShareActions({
  projectId,
  projectLabel,
  clientName,
  filterLabel = null,
  printFilters,
  summary,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly clientName: string | null
  readonly filterLabel?: string | null
  readonly printFilters: SelectionPrintFilters
  readonly summary: ProjectSelectionsSummary
}): React.ReactElement {
  const [copied, setCopied] = React.useState<CopiedState>(null)
  const [printMode, setPrintMode] = React.useState<SelectionPrintMode>("packet")
  const promptCount = totalSelectionPrompts(summary)
  const emailSubject = `${projectLabel} - Finish selections${
    filterLabel ? ` - ${filterLabel}` : ""
  }`
  function absoluteSelectionUrl(): string {
    return new URL(selectionLink(projectId), window.location.origin).toString()
  }

  function plainEmailBody(): string {
    return [
      `Finish selections are ready for ${projectLabel}.`,
      filterLabel ? `View: ${filterLabel}.` : "",
      clientName ? `Prepared for ${clientName}.` : "",
      "",
      `There ${promptCount === 1 ? "is" : "are"} ${promptCount} selection ${promptCount === 1 ? "item" : "items"} organized by room.`,
      "You can review and fill these out in Compass, or use the attached/printed packet if paper is easier.",
      "",
      `Open finish selections: ${absoluteSelectionUrl()}`,
    ]
      .filter((line) => line.length > 0)
      .join("\n")
  }

  function htmlEmailBody(): string {
    const url = absoluteSelectionUrl()
    const rooms = summary.rooms
      .filter((room) => room.selections.length > 0)
      .slice(0, 8)
      .map(
        (room) =>
          `<li><strong>${escapeHtml(room.roomName)}</strong>: ${room.selections.length} ${room.selections.length === 1 ? "item" : "items"}</li>`
      )
      .join("")

    return `
      <div style="font-family:Arial,sans-serif;color:#1f2933;line-height:1.5;max-width:720px;">
        <p style="margin:0 0 10px 0;color:#4b5563;">Finish selections</p>
        <h2 style="margin:0 0 8px 0;font-size:22px;line-height:1.25;color:#111827;">${escapeHtml(projectLabel)} selections are ready</h2>
        ${
          filterLabel
            ? `<p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;">${escapeHtml(filterLabel)}</p>`
            : ""
        }
        <p style="margin:0 0 14px 0;font-size:15px;color:#374151;">
          We organized the selections by room so you can work through them at your own pace.
        </p>
        <ul style="margin:0 0 18px 20px;padding:0;color:#374151;font-size:14px;">
          ${rooms || "<li>Open Compass to review the current room list.</li>"}
        </ul>
        <a href="${url}" style="display:inline-block;background:#3f7d4d;color:#ffffff;text-decoration:none;border-radius:6px;padding:10px 16px;font-weight:700;">
          Open finish selections
        </a>
        <p style="margin:18px 0 0 0;font-size:12px;color:#6b7280;">
          Prefer paper or a spreadsheet? Let us know and we can send a printable packet.
        </p>
      </div>`.trim()
  }

  function sheetText(): string {
    const rows = [
      [
        "Room",
        "Selection",
        "Category",
        "Quantity",
        "Manufacturer",
        "Model",
        "Color / Finish",
        "Supplier",
        "Cost Code",
        "Product Link",
        "Owner Notes",
      ],
    ]

    for (const room of summary.rooms) {
      if (room.selections.length === 0) {
        rows.push([room.roomName, "", "", "", "", "", "", "", "", "", ""])
        continue
      }

      for (const selection of room.selections) {
        rows.push([
          room.roomName,
          selection.name,
          selection.category,
          selection.quantity === null ? "" : String(selection.quantity),
          plainText(selection.manufacturer),
          plainText(selection.model),
          plainText(selection.colorFinish),
          plainText(selection.supplierName),
          plainText(selection.costCode),
          plainText(selection.productUrl),
          "",
        ])
      }
    }

    return rows
      .map((row) => row.map((cell) => tsvCell(cell)).join("\t"))
      .join("\n")
  }

  async function copyLink(): Promise<void> {
    if (await copyTextToClipboard(absoluteSelectionUrl())) {
      setCopied("link")
      toast.success("Selection link copied")
      return
    }
    showManualCopyDialog({
      title: "Copy selection link",
      text: absoluteSelectionUrl(),
    })
    toast.error("Your browser blocked automatic copying.")
  }

  async function copyEmail(): Promise<void> {
    if (await copyTextToClipboard(
      `Subject: ${emailSubject}\n\n${plainEmailBody()}`
    )) {
      setCopied("email")
      toast.success("Selection email copied")
      return
    }
    showManualCopyDialog({
      title: "Copy selection email",
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
      toast.success("Selection HTML email copied")
      return
    }
    if (result === "plain") {
      setCopied("email")
      toast.success("Selection email copied as plain text")
      return
    }
    showManualCopyDialog({ title: "Copy selection email", text: plain })
    toast.error("Your browser blocked automatic copying.")
  }

  async function copySheet(): Promise<void> {
    if (await copyTextToClipboard(sheetText())) {
      setCopied("sheet")
      toast.success("Selection sheet copied")
      return
    }
    showManualCopyDialog({ title: "Copy selection sheet", text: sheetText() })
    toast.error("Your browser blocked automatic copying.")
  }

  function printPacket(): void {
    const url = new URL(selectionPrintUrl({
      filters: printFilters,
      mode: printMode,
      projectId,
    }), window.location.origin)
    const printWindow = window.open(url.toString(), "_blank", "noopener,noreferrer")

    if (printWindow) {
      toast.success("Print packet opened")
      return
    }

    window.location.href = url.toString()
  }

  return (
    <div className="flex flex-wrap justify-end gap-2 print:hidden">
      <Select
        value={printMode}
        onValueChange={(value) => {
          if (value === "packet" || value === "room_sheets") {
            setPrintMode(value)
          }
        }}
      >
        <SelectTrigger size="sm" className="w-[170px]">
          <SelectValue placeholder="Print style" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="packet">Packet</SelectItem>
          <SelectItem value="room_sheets">Room sheets</SelectItem>
        </SelectContent>
      </Select>
      <Button type="button" size="sm" onClick={printPacket}>
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
      <Button type="button" size="sm" variant="outline" onClick={copySheet}>
        {copied === "sheet" ? (
          <IconCheck className="size-4" />
        ) : (
          <IconFileSpreadsheet className="size-4" />
        )}
        {copied === "sheet" ? "Copied" : "Copy sheet"}
      </Button>
    </div>
  )
}
