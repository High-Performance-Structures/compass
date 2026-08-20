function emailAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value)
  return (match?.[1] ?? value).trim()
}

export function trackedMailtoHref(input: {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  readonly body: string
}): string {
  const recipients = input.to.map((value) => value.trim()).filter(Boolean)
  // URLSearchParams serializes spaces as `+`, which browsers understand but
  // several desktop mail clients preserve literally. Mailto fields are safer
  // with percent encoding so spaces and line breaks survive the app handoff.
  const fields = [
    ["cc", input.cc.map(emailAddress).filter(Boolean).join(",")],
    ["subject", input.subject],
    ["body", input.body],
  ]
  const query = fields
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&")
  return `mailto:${recipients.map(encodeURIComponent).join(",")}?${query}`
}
