import { escapeHtml } from "@/lib/print/rfq-print"

/** The docs request a vendor gets, and the certificate request their agent gets. */
export type TradeDocRequestEmailInput = {
  readonly audience: "vendor" | "agent"
  readonly companyName: string
  readonly companyContactLines: readonly string[]
  readonly vendorName: string
  /** The staff member's note, or the company's standard note. */
  readonly message: string
  readonly items: readonly string[]
  readonly certificateHolder: readonly string[]
  readonly linkUrl: string
  readonly expiresOn: string
  readonly senderName: string
  /** For the agent email: who asked for it. */
  readonly requestedBy: string | null
}

export function tradeDocRequestSubject(input: { readonly audience: "vendor" | "agent"; readonly companyName: string; readonly vendorName: string }): string {
  return input.audience === "agent"
    ? `Certificate of insurance request: ${input.vendorName} for ${input.companyName}`
    : `Documents needed by ${input.companyName}: ${input.vendorName}`
}

function intro(input: TradeDocRequestEmailInput): string {
  if (input.audience === "agent") {
    return `${input.requestedBy ?? input.vendorName} asked us to send you our certificate holder details. Please send ${input.companyName} certificates of insurance for ${input.vendorName}.`
  }
  return `Please send ${input.companyName} the documents below for ${input.vendorName}.`
}

export function tradeDocRequestText(input: TradeDocRequestEmailInput): string {
  return [
    input.message.trim(),
    intro(input),
    "",
    input.audience === "agent" ? "Certificates needed:" : "What we need:",
    ...input.items.map((item) => `- ${item}`),
    "",
    "Certificate holder:",
    ...input.certificateHolder,
    "",
    `Upload them here (no account needed, works until ${input.expiresOn}):`,
    input.linkUrl,
    "",
    "You can also reply to this email with the files attached.",
    "",
    input.companyName,
    ...input.companyContactLines,
    `Sent through Compass by ${input.senderName}.`,
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim()
}

export function tradeDocRequestHtml(input: TradeDocRequestEmailInput): string {
  const items = input.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;max-width:640px;">
      ${input.message.trim() ? `<p>${escapeHtml(input.message.trim()).replaceAll("\n", "<br>")}</p>` : ""}
      <p>${escapeHtml(intro(input))}</p>
      <h3>${input.audience === "agent" ? "Certificates needed" : "What we need"}</h3>
      <ul>${items}</ul>
      <h3>Certificate holder</h3>
      <p>${input.certificateHolder.map(escapeHtml).join("<br>")}</p>
      <p><a href="${escapeHtml(input.linkUrl)}" style="display:inline-block;padding:10px 16px;background:#2f7044;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${
        input.audience === "agent" ? "Upload certificates" : "Upload documents"
      }</a></p>
      <p>No account needed. This link is private to you and works until ${escapeHtml(input.expiresOn)}. You can also reply to this email with the files attached.</p>
      <p><strong>${escapeHtml(input.companyName)}</strong><br>${input.companyContactLines.map(escapeHtml).join("<br>")}</p>
      <p>Sent through Compass by ${escapeHtml(input.senderName)}.</p>
    </div>`.trim()
}
