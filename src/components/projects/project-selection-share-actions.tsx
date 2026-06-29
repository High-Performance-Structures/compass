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
import { openPrintDocument, printNow } from "@/lib/browser-print"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

type CopiedState = "link" | "email" | "html" | "sheet" | null
type PrintMode = "packet" | "room_sheets"

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

function selectionPromptCount(summary: ProjectSelectionsSummary): number {
  return summary.rooms.reduce(
    (total, room) => total + room.selections.length,
    0
  )
}

function packetSelectionRows(
  summary: ProjectSelectionsSummary,
  mode: PrintMode,
  projectLabel: string
): string {
  return summary.rooms
    .map((room) => {
      const selectionRows =
        room.selections.length === 0
          ? `<div class="selection-print-blank-row"><p>No selection prompts added yet.</p></div>`
          : room.selections
              .map(
                (selection) => `
                  <div class="selection-print-item">
                    <div class="selection-print-item-title">
                      <h3>${escapeHtml(selection.name)}</h3>
                      <span>${escapeHtml(selection.category)}</span>
                    </div>
                    <div class="selection-print-grid">
                      <div>
                        <span>Manufacturer</span>
                        <p>${escapeHtml(plainText(selection.manufacturer))}</p>
                      </div>
                      <div>
                        <span>Model</span>
                        <p>${escapeHtml(plainText(selection.model))}</p>
                      </div>
                      <div>
                        <span>Color / Finish</span>
                        <p>${escapeHtml(plainText(selection.colorFinish))}</p>
                      </div>
                      <div>
                        <span>Supplier</span>
                        <p>${escapeHtml(plainText(selection.supplierName))}</p>
                      </div>
                    </div>
                    ${
                      selection.productUrl
                        ? `<p class="selection-print-link">Product link: ${escapeHtml(selection.productUrl)}</p>`
                        : ""
                    }
                    <div class="selection-print-notes">
                      <span>Owner notes / questions</span>
                    </div>
                  </div>`
              )
              .join("")

      if (mode === "room_sheets") {
        return `
          <section class="selection-print-room selection-print-room-sheet">
            <header class="selection-print-room-page-header">
              <div>
                <p>${escapeHtml(projectLabel)} · Finish Schedule</p>
                <h2>${escapeHtml(room.roomName)}</h2>
              </div>
              ${room.roomType ? `<span>${escapeHtml(room.roomType)}</span>` : ""}
            </header>
            ${selectionRows}
          </section>`
      }

      return `
        <section class="selection-print-room">
          <div class="selection-print-room-heading">
            <h2>${escapeHtml(room.roomName)}</h2>
            ${room.roomType ? `<span>${escapeHtml(room.roomType)}</span>` : ""}
          </div>
          ${selectionRows}
        </section>`
    })
    .join("")
}

function packetHtml({
  projectLabel,
  clientName,
  filterLabel,
  selectionUrl,
  summary,
  mode,
}: {
  readonly projectLabel: string
  readonly clientName: string | null
  readonly filterLabel: string | null
  readonly selectionUrl: string
  readonly summary: ProjectSelectionsSummary
  readonly mode: PrintMode
}): string {
  const packetTitle =
    mode === "room_sheets" ? "Room Finish Schedules" : "Finish Selections"
  const packetNote =
    mode === "room_sheets"
      ? "Room sheets are formatted for jobsite posting. Each room starts on its own page."
      : "Please review each room and fill in the selections that are ready for your decision. Product links, supplier notes, colors, finishes, and questions are all helpful."

  return `
    <header class="selection-print-header">
      <div class="selection-print-brand">
        <img src="/department-logos/orc-mark.png" alt="Open Range Construction" />
        <div>
          <p>Open Range Construction</p>
          <span>Finish Selection Packet</span>
        </div>
      </div>
      <div class="selection-print-meta">
        <p>${escapeHtml(projectLabel)}</p>
        ${clientName ? `<span>${escapeHtml(clientName)}</span>` : ""}
        ${filterLabel ? `<span>${escapeHtml(filterLabel)}</span>` : ""}
      </div>
    </header>

    <section class="selection-print-intro">
      <h1>${packetTitle}</h1>
      <p>${escapeHtml(packetNote)}</p>
      <a class="selection-print-open-link" href="${escapeHtml(selectionUrl)}">
        Open this selection page in Compass
      </a>
    </section>

    <div class="selection-print-rooms">
      ${packetSelectionRows(summary, mode, projectLabel)}
    </div>`.trim()
}

function selectionPrintStyles(): string {
  return `
    @page {
      margin: 0.35in;
      size: letter;
    }

    * {
      box-sizing: border-box;
    }

    body {
      background: #f4efe8;
      color: #111111;
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 24px;
    }

    .print-help {
      align-items: center;
      display: flex;
      justify-content: center;
      margin: 0 0 16px;
    }

    .print-help button {
      background: #3f7d4d;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 700 13px Arial, sans-serif;
      padding: 10px 16px;
    }

    .selection-printable {
      background: #ffffff;
      color: #111111;
      font-family: Arial, sans-serif;
      margin: 0 auto;
      max-width: 8.5in;
      min-height: 10in;
      padding: 0.35in;
    }

    .selection-print-header {
      align-items: flex-start;
      border-bottom: 2px solid #6f471f;
      display: flex;
      justify-content: space-between;
      padding-bottom: 0.07in;
    }

    .selection-print-brand {
      align-items: center;
      display: flex;
      gap: 0.09in;
    }

    .selection-print-brand img {
      height: 0.34in;
      object-fit: contain;
      width: 0.34in;
    }

    .selection-print-brand p,
    .selection-print-meta p {
      color: #201105;
      font-size: 11px;
      font-weight: 700;
      margin: 0;
      text-transform: uppercase;
    }

    .selection-print-brand span,
    .selection-print-meta span {
      display: block;
      font-size: 10px;
      margin-top: 0.03in;
    }

    .selection-print-meta {
      text-align: right;
    }

    .selection-print-intro {
      align-items: end;
      display: grid;
      gap: 0.18in;
      grid-template-columns: minmax(1.8in, 0.55fr) minmax(3.2in, 1fr);
      padding: 0.08in 0 0.06in;
    }

    .selection-print-intro h1 {
      font-size: 16px;
      line-height: 1.1;
      margin: 0;
    }

    .selection-print-intro p {
      font-size: 10px;
      line-height: 1.25;
      margin: 0;
      max-width: none;
    }

    .selection-print-open-link {
      align-self: start;
      color: #3f7d4d;
      font-size: 9px;
      font-weight: 700;
      justify-self: end;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .selection-print-rooms {
      display: grid;
      gap: 0.1in;
    }

    .selection-print-room {
      border: 1px solid #6f471f;
      break-inside: auto;
      page-break-inside: auto;
    }

    .selection-print-room-sheet {
      break-before: page;
      page-break-before: always;
    }

    .selection-print-room-sheet:first-child {
      break-before: auto;
      page-break-before: auto;
    }

    .selection-print-room-page-header {
      align-items: baseline;
      background: #ffffff;
      border-bottom: 2px solid #6f471f;
      display: flex;
      justify-content: space-between;
      padding: 0.08in 0.1in;
    }

    .selection-print-room-page-header p {
      color: #6f471f;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin: 0 0 0.02in;
      text-transform: uppercase;
    }

    .selection-print-room-page-header h2 {
      color: #201105;
      font-size: 15px;
      font-weight: 800;
      margin: 0;
    }

    .selection-print-room-page-header span {
      font-size: 10px;
    }

    .selection-print-room-heading {
      align-items: baseline;
      background: #efe5d8;
      border-bottom: 1px solid #6f471f;
      display: flex;
      gap: 0.1in;
      justify-content: space-between;
      padding: 0.08in 0.1in;
    }

    .selection-print-room-heading h2 {
      color: #201105;
      font-size: 13px;
      font-weight: 800;
      margin: 0;
    }

    .selection-print-room-heading span {
      font-size: 10px;
    }

    .selection-print-item {
      break-inside: avoid;
      border-top: 1px solid #cccccc;
      padding: 0.1in;
      page-break-inside: avoid;
    }

    .selection-print-room .selection-print-item:first-of-type {
      border-top: 0;
    }

    .selection-print-item-title {
      align-items: baseline;
      display: flex;
      gap: 0.1in;
      justify-content: space-between;
    }

    .selection-print-item-title h3 {
      font-size: 12px;
      margin: 0;
    }

    .selection-print-item-title span,
    .selection-print-grid span,
    .selection-print-notes span {
      color: #444444;
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .selection-print-grid {
      display: grid;
      gap: 0.08in;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 0.08in;
    }

    .selection-print-grid div {
      border-bottom: 1px solid #999999;
      min-height: 0.24in;
    }

    .selection-print-grid p,
    .selection-print-link {
      font-size: 10px;
      line-height: 1.25;
      margin: 0.03in 0 0;
    }

    .selection-print-link {
      word-break: break-all;
    }

    .selection-print-notes {
      border: 1px solid #999999;
      height: 0.46in;
      margin-top: 0.1in;
      padding: 0.04in;
    }

    .selection-print-blank-row {
      min-height: 0.42in;
      padding: 0.1in;
    }

    .selection-print-blank-row p {
      color: #555555;
      font-size: 10px;
      margin: 0;
    }

    @media print {
      body {
        background: #ffffff;
        padding: 0;
      }

      .print-help {
        display: none;
      }

      .selection-printable {
        box-shadow: none;
        margin: 0;
        max-width: none;
        min-height: 0;
        padding: 0;
      }
    }
  `
}

export function ProjectSelectionShareActions({
  projectId,
  projectLabel,
  clientName,
  filterLabel = null,
  summary,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly clientName: string | null
  readonly filterLabel?: string | null
  readonly summary: ProjectSelectionsSummary
}): React.ReactElement {
  const [copied, setCopied] = React.useState<CopiedState>(null)
  const [printMode, setPrintMode] = React.useState<PrintMode>("packet")
  const promptCount = selectionPromptCount(summary)
  const emailSubject = `${projectLabel} - Finish selections${
    filterLabel ? ` - ${filterLabel}` : ""
  }`
  const printSelectionUrl =
    typeof window === "undefined"
      ? selectionLink(projectId)
      : new URL(selectionLink(projectId), window.location.origin).toString()
  const printPacketHtml = packetHtml({
    projectLabel,
    clientName,
    filterLabel,
    mode: printMode,
    selectionUrl: printSelectionUrl,
    summary,
  })

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
    const opened = openPrintDocument({
      bodyHtml: printPacketHtml,
      styles: selectionPrintStyles(),
      title: `${projectLabel} Finish Selections`,
    })

    if (opened) {
      toast.success("Print packet opened")
      return
    }

    document.body.classList.add("selection-printing-selected")

    printNow(() => {
      document.body.classList.remove("selection-printing-selected")
    })
  }

  return (
    <>
      <article
        data-selection-print-root="true"
        className="selection-printable hidden bg-white text-black"
        dangerouslySetInnerHTML={{
          __html: printPacketHtml,
        }}
      />
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
    </>
  )
}
