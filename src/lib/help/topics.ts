import { HELP_TOPIC_LOCATIONS } from "@/lib/help/help-topics.generated"
import type { HelpTopicLocation } from "@/lib/help/types"

/**
 * Light lookup from a Help topic ID to its guide and section.
 *
 * Use this instead of `getHelpTopic` from `@/lib/help` when the caller only
 * needs IDs and links. `@/lib/help` carries every guide's full text (~765 KB);
 * importing it from a module client components also use (for example
 * `videos.ts`, through the video player) puts that text in the client graph
 * and leaves it to tree-shaking to drop. The index here is generated
 * alongside the guides by `bun run help:generate`.
 */
export function getHelpTopicLocation(topicId: string): HelpTopicLocation | null {
  return Object.hasOwn(HELP_TOPIC_LOCATIONS, topicId)
    ? HELP_TOPIC_LOCATIONS[topicId]
    : null
}
