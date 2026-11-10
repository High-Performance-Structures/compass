"use client"

/*
 * The Selections page's Print & share area: Print Preview organized by room
 * (owner packet or one page per room) or by category (one document, or one
 * page per category for trades), the spreadsheet copy in the same order, and
 * the share link / email drafts. The printout and sheet text come from
 * src/lib/selections/selection-packet.ts.
 */
import * as React from "react"
import {
  IconCheck,
  IconCopy,
  IconFileSpreadsheet,
  IconMail,
  IconEye,
  IconSparkles,
} from "@tabler/icons-react"

import type {
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { ProjectBrand } from "@/lib/project-branding"
import {
  packetHtml,
  packetTitles,
  selectionSheetText,
  type SelectionOrganizeBy,
  type SelectionPrintMode,
} from "@/lib/selections/selection-packet"
import { escapeHtml } from "@/lib/shared/text"
import { openPrintSnapshot } from "@/components/print/open-print-snapshot"

type CopiedState = "link" | "email" | "html" | "sheet" | null

function selectionLink(projectId: string): string {
  return `/dashboard/projects/${projectId}/selections`
}

function selectionPromptCount(summary: ProjectSelectionsSummary): number {
  return summary.rooms.reduce(
    (total, room) => total + room.selections.length,
    0
  )
}

export function ProjectSelectionShareActions({
  brand,
  projectId,
  projectLabel,
  clientName,
  filterLabel = null,
  summary,
}: {
  readonly brand: ProjectBrand
  readonly projectId: string
  readonly projectLabel: string
  readonly clientName: string | null
  readonly filterLabel?: string | null
  readonly summary: ProjectSelectionsSummary
}): React.ReactElement {
  const [copied, setCopied] = React.useState<CopiedState>(null)
  const [printMode, setPrintMode] = React.useState<SelectionPrintMode>("packet")
  const [organizeBy, setOrganizeBy] = React.useState<SelectionOrganizeBy>("room")
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const promptCount = selectionPromptCount(summary)
  const emailSubject = `${projectLabel} - Finish selections${
    filterLabel ? ` - ${filterLabel}` : ""
  }`

  React.useEffect(() => {
    const logo = new window.Image()
    logo.decoding = "sync"
    logo.src = brand.logoSrc
  }, [brand.logoSrc])

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
      "",
      brand.companyName,
      ...brand.contactLines,
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
        <div style="margin-top:20px;border-top:1px solid #d1d5db;padding-top:12px;font-size:12px;color:#6b7280;">
          <strong>${escapeHtml(brand.companyName)}</strong><br>
          ${brand.contactLines.map((line) => escapeHtml(line)).join("<br>")}
        </div>
      </div>`.trim()
  }

  async function copyLink(): Promise<void> {
    await navigator.clipboard.writeText(absoluteSelectionUrl())
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

  async function copySheet(): Promise<void> {
    await navigator.clipboard.writeText(selectionSheetText(summary, organizeBy))
    setCopied("sheet")
  }

  async function previewPacket(): Promise<void> {
    setPreviewError(null)
    const { documentWords } = packetTitles(printMode, organizeBy)
    const result = await openPrintSnapshot({
      projectId,
      kind: "selection-packet",
      title:
        organizeBy === "category"
          ? printMode === "room_sheets"
            ? "Category finish schedules"
            : "Finish selections by category"
          : printMode === "room_sheets"
            ? "Room finish schedules"
            : "Finish selections",
      documentNumber: `${projectLabel} ${documentWords}`,
      html: packetHtml({
        brand,
        projectLabel,
        clientName,
        filterLabel,
        mode: printMode,
        organizeBy,
        selectionUrl: absoluteSelectionUrl(),
        summary,
      }),
    })
    if (!result.success) setPreviewError(result.error)
  }

  return (
    <div className="space-y-5 print:hidden">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Print</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="selection-print-organize" className="text-xs text-muted-foreground">
              Organize by
            </Label>
            <Select
              value={organizeBy}
              onValueChange={(value) => {
                if (value === "room" || value === "category") setOrganizeBy(value)
              }}
            >
              <SelectTrigger id="selection-print-organize" size="sm" className="w-[170px]">
                <SelectValue placeholder="Organize by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="room">Room</SelectItem>
                <SelectItem value="category">Category</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="selection-print-style" className="text-xs text-muted-foreground">
              Print style
            </Label>
            <Select
              value={printMode}
              onValueChange={(value) => {
                if (value === "packet" || value === "room_sheets") {
                  setPrintMode(value)
                }
              }}
            >
              <SelectTrigger id="selection-print-style" size="sm" className="w-[190px]">
                <SelectValue placeholder="Print style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="packet">Packet</SelectItem>
                {/* Same mode either way: each group starts a new page. */}
                <SelectItem value="room_sheets">
                  {organizeBy === "category" ? "Category sheets" : "Room sheets"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={() => void previewPacket()}>
            <IconEye className="size-4" />
            Print Preview
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {packetTitles(printMode, organizeBy).note} {promptCount} selection
          {promptCount === 1 ? "" : "s"}
          {filterLabel ? ` for ${filterLabel}` : ""}.
        </p>
        {previewError && (
          <p role="alert" className="text-sm text-destructive">
            {previewError}
          </p>
        )}
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-semibold">Spreadsheet</h2>
        <p className="text-xs text-muted-foreground">
          Copies one row per selection, {organizeBy === "category" ? "category" : "room"} first, ready to paste into a sheet.
        </p>
        <Button size="sm" variant="outline" onClick={copySheet}>
          {copied === "sheet" ? (
            <IconCheck className="size-4" />
          ) : (
            <IconFileSpreadsheet className="size-4" />
          )}
          {copied === "sheet" ? "Copied" : "Copy sheet"}
        </Button>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h2 className="text-sm font-semibold">Email & share</h2>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </section>
    </div>
  )
}
