import { getCloudflareContext } from "@/lib/db"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { driveFileIdFromInput } from "@/lib/trade-docs/settings"
import { resolveTradeDocLink } from "@/lib/trade-docs/vendor-link-server"

export const dynamic = "force-dynamic"

const GOOGLE_EXPORTS: Readonly<Record<string, string>> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/pdf",
}

function notFound(): Response {
  return new Response("This form isn't available. Reply to the email and we'll send it.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}

/**
 * A blank form from Settings → Trade docs, downloaded through the vendor's
 * docs link. Only forms for documents on that request can be fetched, and
 * Drive is read as the staff member who sent the link.
 */
export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly token: string; readonly typeId: string }> },
): Promise<Response> {
  const { token, typeId } = await params
  const { env } = await getCloudflareContext()
  const link = await resolveTradeDocLink(env, token, new Date())
  const type = link?.types.find((item) => item.id === typeId)
  if (!link || !type) return notFound()
  const alternative = new URL(request.url).searchParams.get("alternative") === "1"
  const fileId = driveFileIdFromInput(alternative ? type.waiverFormLink : type.formLink)
  if (!fileId) return notFound()
  try {
    const drive = await getOrganizationDriveContext({ db: link.db, environment: env, organizationId: link.organizationId, user: link.sender })
    const file = await drive.client.getFile(drive.userEmail, fileId)
    const exportType = GOOGLE_EXPORTS[file.mimeType]
    const response = exportType
      ? await drive.client.exportFile(drive.userEmail, fileId, exportType)
      : await drive.client.downloadFile(drive.userEmail, fileId)
    if (!response.ok || !response.body) return notFound()
    const name = (exportType ? `${file.name.replace(/\.[^.]+$/, "")}.pdf` : file.name).replace(/["\r\n]/g, "")
    return new Response(response.body, {
      headers: {
        "Content-Type": exportType ?? file.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    })
  } catch (error) {
    console.error("[vendor-docs] form download failed", error)
    return notFound()
  }
}
