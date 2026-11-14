import { describe, expect, it } from "vitest"

import { senderAuthenticationFromHeaders } from "@/lib/email/sender-authentication"

const results = (value: string) => ({ name: "Authentication-Results", value })

describe("Gmail's sender verdict", () => {
  it("passes on DMARC, or on DKIM or SPF aligned with the From domain", () => {
    expect(senderAuthenticationFromHeaders([results("mx.google.com; dkim=pass header.i=@example.test; spf=pass smtp.mailfrom=pat@example.test; dmarc=pass (p=NONE) header.from=example.test")], "pat@example.test")).toBe("pass")
    expect(senderAuthenticationFromHeaders([results("mx.google.com; dkim=pass header.i=@mail.example.test header.s=s1")], "pat@example.test")).toBe("pass")
    expect(senderAuthenticationFromHeaders([results("mx.google.com; spf=pass (google.com: domain designates 1.2.3.4) smtp.mailfrom=bounce@example.test")], "Pat@Example.test")).toBe("pass")
  })

  it("fails when nothing that passed belongs to the From domain", () => {
    expect(senderAuthenticationFromHeaders([results("mx.google.com; dkim=pass header.i=@mailer.test; spf=pass smtp.mailfrom=bounce@mailer.test; dmarc=fail (p=NONE) header.from=example.test")], "pat@example.test")).toBe("fail")
    expect(senderAuthenticationFromHeaders([results("mx.google.com; spf=softfail smtp.mailfrom=pat@example.test; dkim=none")], "pat@example.test")).toBe("fail")
  })

  it("reads only Gmail's own verdict at the top, never one written lower down by the sender", () => {
    const forged = results("mx.google.com; dmarc=pass header.from=example.test")
    expect(senderAuthenticationFromHeaders([results("mx.google.com; spf=fail smtp.mailfrom=pat@example.test; dmarc=fail header.from=example.test"), forged], "pat@example.test")).toBe("fail")
    expect(senderAuthenticationFromHeaders([results("evil.test; dmarc=pass header.from=example.test")], "pat@example.test")).toBe("none")
    expect(senderAuthenticationFromHeaders([{ name: "From", value: "pat@example.test" }], "pat@example.test")).toBe("none")
  })
})
