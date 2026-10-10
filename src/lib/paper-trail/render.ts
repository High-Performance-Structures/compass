import type { RecordCopyGrant } from "@/lib/paper-trail/print-token"
import { createRecordCopyToken, RECORD_COPY_TOKEN_HEADER } from "@/lib/paper-trail/print-token"

/**
 * Prints one record to PDF with Cloudflare Browser Run, in the same format
 * Compass already prints it (PO pickup copy, estimate report, RFI and change
 * order reports). The renderer opens the record-copy page with a short-lived
 * single-record pass in a request header; no person's session is involved.
 */
export async function renderRecordCopyPdf(env: CloudflareEnv, grant: RecordCopyGrant): Promise<ArrayBuffer> {
  const quickAction = Reflect.get(env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") {
    throw new Error("Cloudflare Browser Run is not available for record copies.")
  }
  const origin = new URL(env.WORKOS_REDIRECT_URI).origin
  const token = await createRecordCopyToken(env, grant)
  const rendered: unknown = await Reflect.apply(quickAction, env.BROWSER, [
    "pdf",
    {
      url: new URL("/print/record-copy", origin).toString(),
      setExtraHTTPHeaders: { [RECORD_COPY_TOKEN_HEADER]: token },
      gotoOptions: { waitUntil: "networkidle2", timeout: 60_000 },
      waitForSelector: { selector: "[data-record-copy-ready]", timeout: 60_000 },
      pdfOptions: { format: "letter", printBackground: true, preferCSSPageSize: true },
    },
  ])
  if (!(rendered instanceof Response) || !rendered.ok) {
    throw new Error("Unable to render the record copy.")
  }
  return rendered.arrayBuffer()
}
