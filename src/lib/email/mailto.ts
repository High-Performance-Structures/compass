function emailAddress(value: string): string {
  const match = /<([^<>]+)>/.exec(value)
  return (match?.[1] ?? value).trim()
}

export function trackedMailtoHref(input: {
  readonly to: readonly string[]
  readonly cc: string
  readonly subject: string
  readonly body: string
}): string {
  const recipients = input.to.map((value) => value.trim()).filter(Boolean)
  const query = new URLSearchParams({
    cc: emailAddress(input.cc),
    subject: input.subject,
    body: input.body,
  })
  return `mailto:${recipients.map(encodeURIComponent).join(",")}?${query.toString()}`
}
