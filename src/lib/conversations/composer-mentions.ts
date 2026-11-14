import { isRecord } from "@/lib/shared/guards"

/** A mention in a composed message, as sendMessage expects it. */
export type MentionInput = {
  mentionType: "user" | "channel" | "here" | "agent"
  targetId: string | null
}

function mentionFor(id: string): MentionInput {
  if (id === "channel") return { mentionType: "channel", targetId: null }
  if (id === "here") return { mentionType: "here", targetId: null }
  if (id === "compass-agent") return { mentionType: "agent", targetId: "compass-agent" }
  return { mentionType: "user", targetId: id }
}

/** Every @mention in a TipTap document, in order. */
export function extractMentions(json: Readonly<Record<string, unknown>>): Array<MentionInput> {
  const mentions: Array<MentionInput> = []
  const walk = (node: Readonly<Record<string, unknown>>): void => {
    if (node.type === "mention" && isRecord(node.attrs) && typeof node.attrs.id === "string") {
      mentions.push(mentionFor(node.attrs.id))
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) if (isRecord(child)) walk(child)
    }
  }
  walk(json)
  return mentions
}
