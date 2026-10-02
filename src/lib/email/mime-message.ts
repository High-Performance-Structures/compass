import { Buffer } from "node:buffer"

export type CompassEmailAttachment = {
  readonly filename: string
  readonly contentType: string
  readonly content: Uint8Array
}

function header(value: string): string { return value.replace(/[\r\n]+/g, " ").trim() }
function encodedText(value: string): string { return /^[\x20-\x7e]*$/.test(value) ? header(value) : `=?UTF-8?B?${Buffer.from(header(value), "utf8").toString("base64")}?=` }
function textPart(type: string, value: string): string {
  return [`Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", Buffer.from(value, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n")].join("\r\n")
}

export function buildCompassMimeMessage(input: {
  readonly from: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly replyTo: string | null
  readonly headers: readonly { readonly name: string; readonly value: string }[]
  readonly subject: string
  readonly text: string
  readonly html: string | null
  readonly attachments: readonly CompassEmailAttachment[]
}): string {
  const headers = [
    `From: ${header(input.from)}`, `To: ${input.to.map(header).join(", ")}`,
    input.cc.length ? `Cc: ${input.cc.map(header).join(", ")}` : null,
    input.bcc.length ? `Bcc: ${input.bcc.map(header).join(", ")}` : null,
    input.replyTo ? `Reply-To: ${header(input.replyTo)}` : null,
    `Subject: ${encodedText(input.subject)}`,
    ...input.headers.filter((item) => /^[A-Za-z0-9-]+$/.test(item.name)).map((item) => `${item.name}: ${header(item.value)}`),
    "MIME-Version: 1.0",
  ].filter((line): line is string => line !== null)
  const alternative = `compass-alt-${crypto.randomUUID()}`
  const body = input.html === null ? textPart("text/plain", input.text) : [
    `Content-Type: multipart/alternative; boundary="${alternative}"`, "",
    `--${alternative}`, textPart("text/plain", input.text),
    `--${alternative}`, textPart("text/html", input.html), `--${alternative}--`, "",
  ].join("\r\n")
  if (input.attachments.length === 0) return [...headers, body].join("\r\n")
  const boundary = `compass-files-${crypto.randomUUID()}`
  const parts = input.attachments.map((file) => {
    const name = header(file.filename).replace(/["\\]/g, "_") || "attachment"
    const fallback = name.replace(/[^\x20-\x7e]/g, "_")
    const contentType = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(file.contentType) ? file.contentType : "application/octet-stream"
    return [`--${boundary}`, `Content-Type: ${contentType}`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`, "", Buffer.from(file.content).toString("base64").replace(/(.{76})/g, "$1\r\n")].join("\r\n")
  })
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, body, ...parts, `--${boundary}--`, ""].join("\r\n")
}
