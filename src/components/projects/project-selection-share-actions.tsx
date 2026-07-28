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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ProjectBrand } from "@/lib/project-branding"

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
  brand,
  projectLabel,
  clientName,
  filterLabel,
  selectionUrl,
  summary,
  mode,
}: {
  readonly brand: ProjectBrand
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
        <img src="${escapeHtml(brand.logoSrc)}" alt="${escapeHtml(brand.logoAlt)}" />
        <div>
          <p>${escapeHtml(brand.companyName)}</p>
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
  const [printMode, setPrintMode] = React.useState<PrintMode>("packet")
  const promptCount = selectionPromptCount(summary)
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
    await navigator.clipboard.writeText(sheetText())
    setCopied("sheet")
  }

  function printPacket(): void {
    const printRoot = document.createElement("article")
    printRoot.setAttribute("data-selection-print-root", "true")
    printRoot.className = "selection-printable bg-white text-black"
    printRoot.innerHTML = packetHtml({
      brand,
      projectLabel,
      clientName,
      filterLabel,
      mode: printMode,
      selectionUrl: absoluteSelectionUrl(),
      summary,
    })

    document.body.classList.add("selection-printing-selected")
    document.body.appendChild(printRoot)

    const resetPrintState = (): void => {
      printRoot.remove()
      document.body.classList.remove("selection-printing-selected")
      window.removeEventListener("afterprint", resetPrintState)
    }

    window.addEventListener("afterprint", resetPrintState)
    window.print()
    window.setTimeout(resetPrintState, 5000)
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
      <Button size="sm" onClick={printPacket}>
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
      <Button size="sm" variant="outline" onClick={copySheet}>
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
