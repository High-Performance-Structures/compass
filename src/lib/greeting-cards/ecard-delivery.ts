import "server-only"

type EcardEmailContent = {
  readonly subject: string
  readonly text: string
  readonly html: string
}

function environmentString(env: object, key: string): string | null {
  const value: unknown = Reflect.get(env, key)
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }
  const processValue = process.env[key]
  return typeof processValue === "string" && processValue.trim().length > 0
    ? processValue.trim()
    : null
}

export function getEcardPublicBaseUrl(env: object):
  | { readonly success: true; readonly data: string }
  | { readonly success: false; readonly error: string } {
  const configured =
    environmentString(env, "COMPASS_PUBLIC_BASE_URL") ??
    environmentString(env, "SOCIAL_PUBLIC_BASE_URL")
  if (!configured) {
    return {
      success: false,
      error: "Compass e-card delivery is not configured. Missing: COMPASS_PUBLIC_BASE_URL.",
    }
  }
  try {
    const url = new URL(configured)
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      return {
        success: false,
        error: "COMPASS_PUBLIC_BASE_URL must use HTTPS.",
      }
    }
    return { success: true, data: url.origin }
  } catch {
    return {
      success: false,
      error: "COMPASS_PUBLIC_BASE_URL must be a valid absolute URL.",
    }
  }
}

export function ecardUrl(baseUrl: string, publicToken: string): string {
  return new URL(`/ecard/${encodeURIComponent(publicToken)}`, baseUrl).toString()
}

export function buildEcardEmail(input: {
  readonly recipientFirstName: string
  readonly cardName: string
  readonly occasion: string | null
  readonly giftAmountCents: number | null
  readonly url: string
}): EcardEmailContent {
  const hasGift = input.giftAmountCents !== null
  const subject = hasGift
    ? `A card and gift from High Performance Structures`
    : `A card from High Performance Structures`
  const giftLine = hasGift
    ? ` A $${(input.giftAmountCents / 100).toFixed(2)} digital gift is waiting inside.`
    : ""
  const text = [
    `Hi ${input.recipientFirstName},`,
    "",
    `High Performance Structures sent you a ${input.cardName} e-card.${giftLine}`,
    input.occasion ? `Occasion: ${input.occasion}` : null,
    "",
    `Open your card: ${input.url}`,
    "",
    "This private link was created for you. Please do not forward it if it includes a gift.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n")

  return {
    subject,
    text,
    html: [
      "<!doctype html>",
      '<html lang="en"><body>',
      `<main><p>Hi ${escapeHtml(input.recipientFirstName)},</p>`,
      `<h1>${escapeHtml(input.cardName)}</h1>`,
      `<p>High Performance Structures sent you an e-card.${escapeHtml(giftLine)}</p>`,
      input.occasion
        ? `<p><strong>${escapeHtml(input.occasion)}</strong></p>`
        : "",
      `<p><a href="${escapeHtml(input.url)}">Open your card</a></p>`,
      "<p><small>This private link was created for you. Please do not forward it if it includes a gift.</small></p>",
      "</main></body></html>",
    ].join(""),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
