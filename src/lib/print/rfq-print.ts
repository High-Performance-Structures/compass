import type { ProjectRfqItem } from "@/app/actions/project-operations"
import type { ProjectBrand } from "@/lib/project-branding"

export function escapeHtml(value: string): string {
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

export function rfqLink(projectId: string, rfqId: string): string {
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

/** The printed RFQ; styled by the rfq-print rules in globals.css. */
export function rfqPrintHtml({
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
          <img src="${escapeHtml(brand.logoSrc)}" alt="${escapeHtml(brand.logoAlt)}" loading="eager" decoding="sync" data-project-brand-logo="true" />
          <div>
            <p>${escapeHtml(brand.companyName)}</p>
            <h1>${escapeHtml(rfq.title)}</h1>
            <div data-project-brand-contact="true">
              ${brand.contactLines
                .map(
                  (line) =>
                    `<span style="display:block;margin-top:0.02in;text-align:left;text-transform:none;">${escapeHtml(line)}</span>`
                )
                .join("")}
            </div>
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
              <th>Division</th>
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
