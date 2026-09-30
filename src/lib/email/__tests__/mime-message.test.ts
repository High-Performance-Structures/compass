import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import { buildCompassMimeMessage } from "../mime-message"

const input = { from: "Compass <compass@example.test>", to: ["owner@example.test"], cc: [], bcc: ["quiet@example.test"], replyTo: "Project <jarvis+token@example.test>", headers: [{ name: "X-Compass-Reply-Token", value: "token" }], subject: "Plans — revision 2", text: "Please review.\nThank you.", html: "<p>Please review.</p>", attachments: [{ filename: "Plan résumé.pdf", contentType: "application/pdf", content: new Uint8Array([0, 255, 123, 10]) }] }

describe("project email MIME attachments", () => {
  it("encodes binary files, unicode filenames, and nested text/HTML without corrupting recipients or tracking", () => {
    const source = buildCompassMimeMessage(input)
    expect(source).toContain("Content-Type: multipart/mixed;")
    expect(source).toContain("Content-Type: multipart/alternative;")
    expect(source).toContain("To: owner@example.test\r\n")
    expect(source).toContain("Bcc: quiet@example.test\r\n")
    expect(source).toContain("Reply-To: Project <jarvis+token@example.test>\r\n")
    expect(source).toContain("X-Compass-Reply-Token: token\r\n")
    expect(source).toContain("filename*=UTF-8''Plan%20r%C3%A9sum%C3%A9.pdf")
    expect(source).toContain(Buffer.from(input.attachments[0].content).toString("base64"))
    expect(source).toContain(Buffer.from(input.text).toString("base64"))
    const boundaries = [...source.matchAll(/boundary="([^"]+)"/g)].map((match) => match[1])
    expect(boundaries).toHaveLength(2)
    for (const boundary of boundaries) expect(source).toContain(`--${boundary}--`)
  })
  it("removes header injection in filenames, MIME types, and subjects", () => {
    const source = buildCompassMimeMessage({ ...input, subject: "Hello\r\nX-Injected: yes", attachments: [{ filename: 'report"\r\nX-Injected: yes.pdf', contentType: "text/plain\r\nX-Injected: yes", content: new Uint8Array([1]) }] })
    expect(source).not.toContain("\r\nX-Injected:")
    expect(source).toContain("Content-Type: application/octet-stream")
  })
  it("supports a text-only message and an empty binary file", () => {
    const textOnly = buildCompassMimeMessage({ ...input, html: null, attachments: [] })
    expect(textOnly).not.toContain("multipart/")
    expect(textOnly).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(buildCompassMimeMessage({ ...input, attachments: [{ filename: "empty.txt", contentType: "text/plain", content: new Uint8Array(0) }] })).toContain('filename="empty.txt"')
  })
})
