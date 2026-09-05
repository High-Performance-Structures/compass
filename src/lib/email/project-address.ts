const PROJECT_EMAIL_MAILBOX = "jarvis@hps-colorado.com"
const PROJECT_ADDRESS_PREFIX = "project-"

export const PROJECT_EMAIL_SUBJECT_TAGS = [
  { tag: "[MESSAGE]", destination: "Project Messages" },
  { tag: "[RFI]", destination: "RFI" },
  { tag: "[RFQ]", destination: "RFQ draft" },
  { tag: "[CHANGE ORDER]", destination: "Change Order draft" },
  { tag: "[TO-DO]", destination: "To-Do" },
  { tag: "[DELIVERY]", destination: "Delivery To-Do" },
  { tag: "[DAILY LOG]", destination: "Daily Log" },
  { tag: "[VIDEO]", destination: "Project Video" },
] as const

export type ProjectEmailDestination =
  | "message"
  | "rfi"
  | "rfq"
  | "change_order"
  | "todo"
  | "delivery"
  | "daily_log"
  | "video"

function splitEmailAddress(email: string): {
  readonly localPart: string
  readonly domain: string
} | null {
  const trimmed = email.trim()
  const atIndex = trimmed.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null
  return {
    localPart: trimmed.slice(0, atIndex),
    domain: trimmed.slice(atIndex + 1),
  }
}

export function projectInboundEmailAddress(projectId: string): string {
  const mailbox = splitEmailAddress(PROJECT_EMAIL_MAILBOX)
  if (!mailbox) return PROJECT_EMAIL_MAILBOX
  return `${mailbox.localPart}+${PROJECT_ADDRESS_PREFIX}${projectId}@${mailbox.domain}`
}

export function projectIdFromInboundAddress(value: string | null): string | null {
  if (!value) return null
  const match = /\+project-(proj-[a-z0-9-]+)@/i.exec(value)
  return match?.[1]?.toLowerCase() ?? null
}

export function projectEmailDestination(
  subject: string
): ProjectEmailDestination | null {
  const normalized = subject.trim()
  if (/^\[(?:message|messages)\](?:\s|:|-|$)/i.test(normalized)) return "message"
  if (/^\[rfi\](?:\s|:|-|$)/i.test(normalized)) return "rfi"
  if (/^\[rfq\](?:\s|:|-|$)/i.test(normalized)) return "rfq"
  if (/^\[change order\](?:\s|:|-|$)/i.test(normalized)) {
    return "change_order"
  }
  if (/^\[(?:to-do|todo|task)\](?:\s|:|-|$)/i.test(normalized)) return "todo"
  if (/^\[delivery\](?:\s|:|-|$)/i.test(normalized)) return "delivery"
  if (/^\[(?:daily log|daily-log|log)\](?:\s|:|-|$)/i.test(normalized)) {
    return "daily_log"
  }
  if (/^\[video\](?:\s|:|-|$)/i.test(normalized)) return "video"
  return null
}

export function projectEmailTitle(subject: string): string {
  return subject
    .replace(/^\[(?:message|messages|rfi|rfq|change order|to-do|todo|task|delivery|daily log|daily-log|log|video)\]\s*(?::|-)?\s*/i, "")
    .trim()
}
