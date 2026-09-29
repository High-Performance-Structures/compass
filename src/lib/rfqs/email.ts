import type { ProjectBrand } from "@/lib/project-branding"

export type RfqEmailDocument = {
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type RfqEmailInput = {
  readonly brand: ProjectBrand
  readonly projectLabel: string
  readonly rfqNumber: string | null
  readonly title: string
  readonly scope: string | null
  readonly requestedFrom: string | null
  readonly dueDate: string | null
  readonly message: string
  readonly senderName: string
  readonly lines: readonly {
    readonly lineNumber: number
    readonly description: string
    readonly phaseCode: string | null
    readonly costCode: string | null
    readonly notes: string | null
  }[]
  readonly documents: readonly RfqEmailDocument[]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function rfqEmailText(input: RfqEmailInput): string {
  return [
    input.message,
    "",
    `Request for quote: ${input.rfqNumber ?? "RFQ"} · ${input.title}`,
    `Project: ${input.projectLabel}`,
    input.requestedFrom ? `Requested from: ${input.requestedFrom}` : null,
    input.dueDate ? `Response needed by: ${input.dueDate}` : null,
    input.scope ? `Scope: ${input.scope}` : null,
    "",
    "Requested scope",
    ...input.lines.map((line) =>
      [
        `${line.lineNumber}. ${line.description}`,
        line.phaseCode ? `Phase ${line.phaseCode}` : null,
        line.costCode ? `Cost code ${line.costCode}` : null,
        line.notes,
      ].filter(Boolean).join(" · ")
    ),
    "",
    "Plans and specifications (viewer links)",
    ...input.documents.map((document) =>
      `${document.label}: ${document.url}${document.notes ? ` · ${document.notes}` : ""}`
    ),
    "",
    input.brand.companyName,
    ...input.brand.contactLines,
    `Sent through Compass by ${input.senderName}.`,
  ].filter((value) => value !== null).join("\n")
}

export function rfqEmailHtml(input: RfqEmailInput): string {
  const scopeRows = input.lines.map((line) => `
    <tr>
      <td>${line.lineNumber}</td>
      <td>${escapeHtml(line.description)}</td>
      <td>${escapeHtml(line.phaseCode ?? "-")}</td>
      <td>${escapeHtml(line.costCode ?? "-")}</td>
      <td>${escapeHtml(line.notes ?? "-")}</td>
    </tr>`).join("")
  const documentRows = input.documents.map((document) => `
    <li><a href="${escapeHtml(document.url)}">${escapeHtml(document.label)}</a>${
      document.notes ? ` · ${escapeHtml(document.notes)}` : ""
    }</li>`).join("")
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;max-width:760px;">
      <p>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>
      <h2>Request for quote · ${escapeHtml(input.rfqNumber ?? "RFQ")}</h2>
      <p><strong>${escapeHtml(input.title)}</strong><br>
        Project: ${escapeHtml(input.projectLabel)}<br>
        ${input.requestedFrom ? `Requested from: ${escapeHtml(input.requestedFrom)}<br>` : ""}
        ${input.dueDate ? `Response needed by: ${escapeHtml(input.dueDate)}` : ""}
      </p>
      ${input.scope ? `<p>${escapeHtml(input.scope).replaceAll("\n", "<br>")}</p>` : ""}
      <h3>Requested scope</h3>
      <table style="border-collapse:collapse;width:100%;" border="1" cellpadding="6">
        <thead><tr><th>#</th><th>Description</th><th>Phase</th><th>Cost code</th><th>Notes</th></tr></thead>
        <tbody>${scopeRows}</tbody>
      </table>
      <h3>Plans and specifications · viewer links</h3>
      <ul>${documentRows}</ul>
      <p>Please reply to this email with your quote. A Compass account is not required.</p>
      <p><strong>${escapeHtml(input.brand.companyName)}</strong><br>${
        input.brand.contactLines.map(escapeHtml).join("<br>")
      }</p>
      <p>Sent through Compass by ${escapeHtml(input.senderName)}.</p>
    </div>`.trim()
}
