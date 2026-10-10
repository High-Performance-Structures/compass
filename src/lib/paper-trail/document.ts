/**
 * The paper-trail record sheet: a self-contained HTML page (inline styles,
 * no scripts, no remote assets) that the browser renderer turns into a PDF.
 * Keeping it self-contained means the scheduled job never needs a signed-in
 * session or the app's stylesheet to produce a copy.
 */

export type RecordSheetField = readonly [label: string, value: string | null | undefined]

export type RecordSheetSection =
  | { readonly kind: "fields"; readonly heading: string; readonly fields: readonly RecordSheetField[] }
  | {
      readonly kind: "table"
      readonly heading: string
      readonly columns: readonly { readonly label: string; readonly align?: "right" }[]
      readonly rows: readonly (readonly string[])[]
      readonly footer?: readonly string[]
    }
  | { readonly kind: "text"; readonly heading: string; readonly body: string | null | undefined }

export type RecordSheet = {
  readonly companyName: string
  readonly companyLines: readonly string[]
  /** "Purchase Order", "RFI", … */
  readonly recordLabel: string
  /** "PO 1042 · Lumber package" */
  readonly title: string
  readonly projectLabel: string
  readonly status: string | null
  readonly sections: readonly RecordSheetSection[]
  /** ISO time the copy was made; shown in the footer. */
  readonly generatedAt: string
  /** Set on milestone copies, e.g. "Sent to vendor". */
  readonly milestoneLabel?: string | null
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function text(value: string | null | undefined): string {
  const trimmed = value?.trim()
  return trimmed ? escapeHtml(trimmed) : '<span class="empty">—</span>'
}

function multiline(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return '<p class="empty">—</p>'
  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("")
}

function section(item: RecordSheetSection): string {
  const heading = `<h2>${escapeHtml(item.heading)}</h2>`
  if (item.kind === "fields") {
    const rows = item.fields
      .map(([label, value]) => `<div class="field"><dt>${escapeHtml(label)}</dt><dd>${text(value)}</dd></div>`)
      .join("")
    return `<section>${heading}<dl>${rows}</dl></section>`
  }
  if (item.kind === "text") {
    return `<section>${heading}<div class="body">${multiline(item.body)}</div></section>`
  }
  const align = (index: number): string => (item.columns[index]?.align === "right" ? ' class="num"' : "")
  const head = item.columns.map((column, index) => `<th${align(index)}>${escapeHtml(column.label)}</th>`).join("")
  const body =
    item.rows.length === 0
      ? `<tr><td colspan="${item.columns.length}" class="empty">No lines</td></tr>`
      : item.rows
          .map((row) => `<tr>${row.map((cell, index) => `<td${align(index)}>${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("")
  const foot = item.footer
    ? `<tfoot><tr>${item.footer.map((cell, index) => `<td${align(index)}>${escapeHtml(cell)}</td>`).join("")}</tr></tfoot>`
    : ""
  return `<section>${heading}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></section>`
}

function generatedLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.valueOf())) return iso
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(date)
}

export function renderRecordSheet(sheet: RecordSheet): string {
  const milestone = sheet.milestoneLabel
    ? `<p class="milestone">${escapeHtml(sheet.milestoneLabel)} · frozen copy</p>`
    : ""
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${sheet.recordLabel} – ${sheet.title}`)}</title>
<style>
@page { size: letter; margin: 0.6in 0.6in 0.7in; }
* { box-sizing: border-box; }
body { margin: 0; font: 10.5pt/1.45 Helvetica, Arial, sans-serif; color: #1f1d1a; }
header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1.5pt solid #1f1d1a; padding-bottom: 10px; }
.company { font-weight: 700; font-size: 12pt; }
.company-lines { color: #5b554c; font-size: 9pt; }
.record { text-align: right; }
.record-label { text-transform: uppercase; letter-spacing: 0.08em; font-size: 9pt; color: #5b554c; }
h1 { margin: 2px 0 0; font-size: 15pt; }
.project { margin: 10px 0 0; color: #5b554c; }
.status { display: inline-block; margin-top: 4px; font-size: 9pt; border: 0.75pt solid #9a9387; padding: 1px 6px; }
.milestone { margin: 8px 0 0; font-weight: 700; }
section { margin-top: 16px; break-inside: avoid-page; }
h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5b554c; border-bottom: 0.75pt solid #d3cabd; padding-bottom: 3px; margin: 0 0 6px; }
dl { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 0; }
.field { display: grid; grid-template-columns: 9.5em 1fr; gap: 8px; }
dt { color: #5b554c; }
dd { margin: 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 0.5pt solid #d3cabd; vertical-align: top; overflow-wrap: anywhere; }
th { color: #5b554c; font-weight: 600; border-bottom-color: #9a9387; }
tfoot td { font-weight: 700; border-top: 1pt solid #1f1d1a; border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.body p { margin: 0 0 6px; }
.empty { color: #9a9387; }
footer { margin-top: 24px; padding-top: 6px; border-top: 0.5pt solid #d3cabd; color: #9a9387; font-size: 8pt; }
</style>
</head>
<body>
<header>
  <div>
    <div class="company">${escapeHtml(sheet.companyName)}</div>
    <div class="company-lines">${sheet.companyLines.map(escapeHtml).join("<br>")}</div>
  </div>
  <div class="record">
    <div class="record-label">${escapeHtml(sheet.recordLabel)}</div>
    <h1>${escapeHtml(sheet.title)}</h1>
    ${sheet.status ? `<div class="status">${escapeHtml(sheet.status)}</div>` : ""}
  </div>
</header>
<p class="project">${escapeHtml(sheet.projectLabel)}</p>
${milestone}
${sheet.sections.map(section).join("\n")}
<footer>Compass record copy · ${escapeHtml(generatedLabel(sheet.generatedAt))} (Mountain). ${
    sheet.milestoneLabel
      ? "This copy records the document as it stood at this milestone and is never changed."
      : "The live record in Compass is authoritative; this copy is replaced automatically when the record changes."
  }</footer>
</body>
</html>`
}
