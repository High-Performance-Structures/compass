import { getHelpTopic } from "@/lib/help"

/**
 * Tutorial videos shown under Help guide sections. Each one is recorded by
 * `scripts/help-videos/clips/<id>.mjs` and stored as `<id>.mp4` in the private
 * help-video bucket. The guide Markdown is not edited; videos attach to stable
 * section topic IDs instead.
 */
export type HelpVideo = Readonly<{
  id: string
  topicId: string
  title: string
  durationSeconds: number
}>

export const HELP_VIDEOS: readonly HelpVideo[] = [
  {
    id: "daily-logs-create",
    topicId: "daily.logs.create-log",
    title: "Create a daily log",
    durationSeconds: 34,
  },
  {
    id: "photos-approve-visibility",
    topicId: "photos.visibility.approve-visibility",
    title: "Approve photos and set who can see them",
    durationSeconds: 20,
  },
  {
    id: "projects-open-project",
    topicId: "projects.navigation.open-project",
    title: "Find and open a project",
    durationSeconds: 25,
  },
  {
    id: "conversations-send-message",
    topicId: "conversations.send-message",
    title: "Send a project message",
    durationSeconds: 18,
  },
  {
    id: "contacts-add-and-invite",
    topicId: "contacts.access.add-and-invite",
    title: "Add a contact to a project and invite them",
    durationSeconds: 21,
  },
  {
    id: "financials-estimates",
    topicId: "financials.estimates",
    title: "Start an estimate and add a line",
    durationSeconds: 34,
  },
  {
    id: "jarvis-find-records",
    topicId: "jarvis.find-records",
    title: "Ask Jarvis to find and summarize records",
    durationSeconds: 18,
  },
  {
    id: "jarvis-schedule-confirm",
    topicId: "schedule.jarvis-schedule",
    title: "Change the schedule with Jarvis and Confirm",
    durationSeconds: 26,
  },
  {
    id: "owner-updates-draft-with-jarvis",
    topicId: "owner.updates.draft-with-jarvis",
    title: "Draft an owner update with Jarvis",
    durationSeconds: 20,
  },
]

export type HelpVideoWithGuide = HelpVideo & Readonly<{ guideId: string }>

/** Resolves a video and the guide it belongs to, or null if either is unknown. */
export function getHelpVideo(videoId: string): HelpVideoWithGuide | null {
  const video = HELP_VIDEOS.find((candidate) => candidate.id === videoId)
  if (!video) return null
  const topic = getHelpTopic(video.topicId)
  if (!topic?.section) return null
  return { ...video, guideId: topic.guide.id }
}

/** Videos for one guide, keyed by the section ID they appear under. */
export function getHelpVideosForGuide(
  guideId: string
): Readonly<Record<string, HelpVideo>> {
  const bySection: Record<string, HelpVideo> = {}
  for (const video of HELP_VIDEOS) {
    const topic = getHelpTopic(video.topicId)
    if (topic?.guide.id === guideId && topic.section) {
      bySection[topic.section.id] = video
    }
  }
  return bySection
}

export function helpVideoUrl(videoId: string): string {
  return `/api/help/videos/${encodeURIComponent(videoId)}`
}
