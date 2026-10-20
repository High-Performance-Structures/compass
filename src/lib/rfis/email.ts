function dueDateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export function defaultRfiEmailSubject(input: {
  readonly rfiNumber: string
  readonly subject: string
}): string {
  return `[${input.rfiNumber}] ${input.subject}`
}

/** The RFI itself always follows the sender's note, so it can't be left out. */
export function rfiEmailText(input: {
  readonly projectLabel: string
  readonly rfiNumber: string
  readonly subject: string
  readonly question: string
  readonly dueDate: string | null
  readonly message: string
  readonly senderName: string
}): string {
  return [
    input.message.trim() || null,
    input.message.trim() ? "" : null,
    `${input.projectLabel}`,
    `RFI ${input.rfiNumber}: ${input.subject}`,
    input.dueDate ? `Response needed by ${dueDateLabel(input.dueDate)}` : null,
    "",
    "Question:",
    input.question.trim(),
    "",
    "Please reply to this email with your response.",
    "",
    input.senderName,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
}
