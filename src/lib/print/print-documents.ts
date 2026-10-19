/**
 * Documents with a Print Preview. "page" documents are print pages that show
 * on screen as they print; "pdf" documents are styled for print only, so their
 * preview shows the server-rendered PDF of a source page.
 */
export const PRINT_DOCUMENTS = {
  "purchase-order": { title: "Purchase order", render: "page", params: ["purchaseOrderId"], landscape: false },
  "shop-ticket": { title: "Shop ticket", render: "page", params: ["ticketId"], landscape: false },
  "change-order": { title: "Change order", render: "pdf", params: ["changeOrderId"], landscape: false },
  rfq: { title: "Request for quote", render: "pdf", params: ["rfqId"], landscape: false },
  "owner-update": { title: "Owner update", render: "pdf", params: ["updateId"], landscape: false },
  "daily-logs": { title: "Daily logs", render: "pdf", params: ["logIds", "start", "end", "author"], landscape: false },
} as const satisfies Record<
  string,
  {
    readonly title: string
    readonly render: "page" | "pdf"
    readonly params: readonly string[]
    readonly landscape: boolean
  }
>

export type PrintDocument = keyof typeof PRINT_DOCUMENTS

export function isPrintDocument(value: string): value is PrintDocument {
  return Object.hasOwn(PRINT_DOCUMENTS, value)
}

/** Only the document's own query parameters, in its declared order. */
export function printDocumentParams(
  document: PrintDocument,
  values: Readonly<Record<string, string | undefined>>
): Readonly<Record<string, string>> {
  const entries: [string, string][] = []
  for (const key of PRINT_DOCUMENTS[document].params) {
    const value = values[key]
    if (value) entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

function withQuery(path: string, params: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `${path}?${query}` : path
}

export type PrintDocumentLink = {
  readonly projectId: string
  readonly document: PrintDocument
  readonly params: Readonly<Record<string, string | undefined>>
  /** Record number shown in the preview bar and used for the PDF file name. */
  readonly number?: string
}

/** The Print Preview tab for a document. */
export function printPreviewHref(link: PrintDocumentLink): string {
  return withQuery(`/print/projects/${encodeURIComponent(link.projectId)}/${link.document}`, {
    ...printDocumentParams(link.document, link.params),
    ...(link.number ? { number: link.number } : {}),
  })
}

/** The document's PDF, shown inline in the browser. */
export function printPdfHref(link: PrintDocumentLink): string {
  return withQuery(`/api/projects/${encodeURIComponent(link.projectId)}/print/${link.document}`, {
    ...printDocumentParams(link.document, link.params),
    ...(link.number ? { number: link.number } : {}),
  })
}

/** The page the PDF renderer opens. */
export function printSourcePath(projectId: string, document: PrintDocument): string {
  const base = `/print/projects/${projectId}/${document}`
  return PRINT_DOCUMENTS[document].render === "page" ? base : `${base}/source`
}

/** Waited for by the PDF renderer; every print page renders it when ready. */
export const PRINT_READY_SELECTOR = '[data-print-ready="true"]'
