/**
 * Renders a self-contained record sheet to PDF with Cloudflare Browser Run.
 * The HTML is passed inline, so the renderer never loads an app page and
 * needs no session.
 */
export async function renderRecordSheetPdf(env: CloudflareEnv, html: string): Promise<ArrayBuffer> {
  const quickAction = Reflect.get(env.BROWSER, "quickAction")
  if (typeof quickAction !== "function") {
    throw new Error("Cloudflare Browser Run is not available for record copies.")
  }
  const rendered: unknown = await Reflect.apply(quickAction, env.BROWSER, [
    "pdf",
    {
      html,
      gotoOptions: { waitUntil: "load", timeout: 30_000 },
      pdfOptions: { format: "letter", printBackground: true, preferCSSPageSize: true },
    },
  ])
  if (!(rendered instanceof Response) || !rendered.ok) {
    throw new Error("Unable to render the record copy.")
  }
  return rendered.arrayBuffer()
}
