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

/**
 * What the sender wrote, without quoted history: "> ..." lines and the
 * "On ... wrote:" line that introduces them can't mention anyone again.
 * Text written below a quote still counts. Curly quotes become straight.
 */
function newestPart(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line) && !/^\s*On\b.*\bwrote:\s*$/i.test(line))
    .join("\n")
    .replace(/[\u201C\u201D]/g, '"')
}

/** True when the newest part of the email @mentions someone by name. */
export function inboundMessageMentionsSomeone(text: string): boolean {
  return /(?:^|[\s(])@(?=["\p{L}])/u.test(newestPart(text))
}

/**
 * Only explicit @Name tokens count; ordinary email addresses never mention
 * anyone, and an "@" before a space or number ("14 in @ 16 in o.c.") means "at".
 */
export function inboundProjectMessageRecipients(
  text: string,
  staff: readonly InboundMessagePerson[],
): readonly InboundMessagePerson[] | null {
  const written = newestPart(text)
  const matches = Array.from(written.matchAll(/(?:^|[\s(])@(?:"([^"\r\n]+)"|(\p{L}[\p{L}\p{N}_.-]*))/gu))
  // An @ that starts like a name but can't be read (e.g. an unclosed quote) holds the email for review.
  if (Array.from(written.matchAll(/(?:^|[\s(])@(?=["\p{L}])/gu)).length !== matches.length) return null
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
