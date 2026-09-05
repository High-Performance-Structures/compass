export type InboundMessagePerson = {
  readonly id: string
  readonly name: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string
  readonly assigned: boolean
  readonly inApp: boolean
}

function normalized(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ")
}

/** Only explicit @tokens count; ordinary email addresses never mention anyone. */
export function inboundProjectMessageRecipients(
  text: string,
  staff: readonly InboundMessagePerson[],
): readonly InboundMessagePerson[] | null {
  const matches = Array.from(text.matchAll(/(?:^|[\s(])@(?:"([^"\r\n]+)"|([\p{L}\p{N}_][\p{L}\p{N}_.-]*))/gu))
  if (Array.from(text.matchAll(/(?:^|[\s(])@/g)).length !== matches.length) return null
  if (matches.length === 0) {
    const assigned = staff.filter((person) => person.assigned)
    return assigned.length > 0 && assigned.length <= 30 ? assigned : null
  }
  const recipients = new Map<string, InboundMessagePerson>()
  for (const match of matches) {
    const name = normalized((match[1] ?? match[2] ?? "").replace(/[.]+$/, ""))
    const people = staff.filter((person) => {
      const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ")
      return [person.name, fullName, person.firstName ?? "", person.email.split("@")[0] ?? "", fullName.replace(/\s+/g, ".")]
        .some((alias) => normalized(alias) === name)
    })
    // Unknown or duplicate names must never guess a notification recipient.
    if (people.length !== 1 || !people[0]) return null
    recipients.set(people[0].id, people[0])
  }
  return recipients.size <= 30 ? Array.from(recipients.values()) : null
}
