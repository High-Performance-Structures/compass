import { IconPlayerPlay } from "@tabler/icons-react"

import { helpVideoUrl, type HelpVideo } from "@/lib/help/videos"

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = String(seconds % 60).padStart(2, "0")
  return `${minutes}:${rest}`
}

/** A short tutorial video shown under its Help guide section. */
export function HelpVideoPlayer({
  video,
}: {
  readonly video: HelpVideo
}): React.ReactElement {
  return (
    <figure className="not-prose my-5 overflow-hidden rounded-lg border border-border bg-muted/40">
      <video
        className="aspect-video w-full bg-muted"
        src={helpVideoUrl(video.id)}
        controls
        playsInline
        preload="metadata"
        aria-label={`Video: ${video.title}`}
      />
      <figcaption className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <IconPlayerPlay className="size-3.5" />
        <span>{video.title}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDuration(video.durationSeconds)}</span>
      </figcaption>
    </figure>
  )
}
