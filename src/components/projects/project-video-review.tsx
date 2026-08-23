"use client"

import * as React from "react"
import {
  IconArchive,
  IconExternalLink,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  archiveProjectVideo,
  deleteProjectVideo,
  disconnectYoutubeChannel,
  publishProjectVideo,
  updateProjectVideoReview,
  type ProjectVideoItem,
  type ProjectVideoWorkspace,
} from "@/app/actions/project-videos"
import { YoutubeLogo } from "@/components/brand/youtube-logo"
import { ProjectVideoUpload } from "@/components/projects/project-video-upload"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const CHANNELS = [
  { key: "orc", label: "ORC / Design" },
  { key: "hps", label: "HPS" },
  { key: "nutech", label: "Nu-Tech" },
] as const

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

function VideoReviewCard({
  projectId,
  video,
  channelConnected,
}: {
  readonly projectId: string
  readonly video: ProjectVideoItem
  readonly channelConnected: boolean
}): React.ReactElement {
  const router = useRouter()
  const [title, setTitle] = React.useState(video.title)
  const [description, setDescription] = React.useState(video.description ?? "")
  const [audience, setAudience] = React.useState(video.compassAudience)
  const [youtubePrivacy, setYoutubePrivacy] = React.useState(video.youtubePrivacy)
  const [confirmPublic, setConfirmPublic] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function run(
    action: () => Promise<{ readonly success: boolean; readonly error?: string }>,
    successMessage: string
  ): void {
    startTransition(async () => {
      const result = await action()
      if (!result.success) {
        toast.error(result.error ?? "Compass could not update the video.")
        return
      }
      toast.success(successMessage)
      router.refresh()
    })
  }

  return (
    <article className="border-border border-b py-6 first:pt-0 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{statusLabel(video.publishStatus)}</Badge>
            <Badge variant="secondary">{video.youtubeChannelKey.toUpperCase()}</Badge>
            <span className="text-muted-foreground text-xs">
              {formatBytes(video.sourceFileSize)} · {video.sourceFileName}
            </span>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Submitted by {video.submittedByName ?? "project contact"} ·{" "}
            {new Date(video.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {video.driveUrl && (
            <Button asChild size="sm" variant="outline">
              <Link href={video.driveUrl} target="_blank" rel="noreferrer">
                Review source <IconExternalLink />
              </Link>
            </Button>
          )}
          {video.youtubeUrl && (
            <Button asChild size="sm">
              <Link
                href={
                  video.compassAudience === "staff"
                    ? `/api/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(video.id)}`
                    : video.youtubeUrl
                }
                target="_blank"
                rel="noreferrer"
              >
                Watch on <YoutubeLogo />
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`youtube-privacy-${video.id}`}>YouTube privacy</Label>
            <Select value={youtubePrivacy} onValueChange={setYoutubePrivacy}>
              <SelectTrigger id={`youtube-privacy-${video.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="unlisted">Unlisted</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {youtubePrivacy === "public"
                ? "Public: discoverable and viewable by anyone on YouTube."
                : youtubePrivacy === "unlisted"
                  ? "Unlisted: anyone with the YouTube link can view and forward it."
                  : "Private: visible only through YouTube account permissions."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`video-title-${video.id}`}>YouTube title</Label>
            <Input
              id={`video-title-${video.id}`}
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`video-description-${video.id}`}>Description</Label>
            <Textarea
              id={`video-description-${video.id}`}
              value={description}
              maxLength={5000}
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Who may receive the link?</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="staff">Staff only</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="sub_vendor">Subs / suppliers</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Compass audience controls who receives the resulting link; it is
              separate from the YouTube privacy status above.
            </p>
          </div>
          <div className="bg-muted/45 px-3 py-2 text-sm">
            Linked to the Daily Log created from this message. The final link is
            added there after publication.
          </div>
          {youtubePrivacy === "public" && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={confirmPublic}
                onCheckedChange={(checked) => setConfirmPublic(checked === true)}
              />
              <span>I confirm this video is approved for public viewing.</span>
            </label>
          )}
        </div>
      </div>

      {video.uploadError && (
        <p className="text-destructive mt-4 text-sm">{video.uploadError}</p>
      )}
      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(
                () => archiveProjectVideo({ projectId, videoId: video.id }),
                "Video archived."
              )
            }
          >
            <IconArchive /> Archive
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Delete this video record from Compass?")) return
              run(
                () => deleteProjectVideo({ projectId, videoId: video.id }),
                "Video deleted."
              )
            }}
          >
            <IconTrash /> Delete
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || video.publishStatus === "published"}
            onClick={() =>
              run(
                () =>
                  updateProjectVideoReview({
                    projectId,
                    videoId: video.id,
                    title,
                    description,
                    compassAudience: audience,
                    youtubePrivacy,
                  }),
                "Video review saved."
              )
            }
          >
            Save review
          </Button>
          <Button
            type="button"
            disabled={
              pending ||
              video.publishStatus === "published" ||
              !channelConnected ||
              (youtubePrivacy === "public" && !confirmPublic)
            }
            onClick={() =>
              run(
                async () => {
                  const reviewed = await updateProjectVideoReview({
                    projectId,
                    videoId: video.id,
                    title,
                    description,
                    compassAudience: audience,
                    youtubePrivacy,
                  })
                  if (!reviewed.success) return reviewed
                  return publishProjectVideo({
                    projectId,
                    videoId: video.id,
                    confirmPublic,
                  })
                },
                "Video published and linked in Compass."
              )
            }
          >
            <IconUpload /> Publish to YouTube
          </Button>
        </div>
      </div>
      {!channelConnected && (
        <p className="text-muted-foreground mt-2 text-right text-xs">
          Connect the {video.youtubeChannelKey.toUpperCase()} channel before publishing.
        </p>
      )}
    </article>
  )
}

export function ProjectVideoReview({
  workspace,
}: {
  readonly workspace: ProjectVideoWorkspace
}): React.ReactElement {
  const router = useRouter()
  const [channelPending, startTransition] = React.useTransition()
  const connectedKeys = new Set(
    workspace.channels
      .filter((channel) => channel.status === "connected")
      .map((channel) => channel.channelKey)
  )

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-muted-foreground text-sm">
            {workspace.project.projectNumber ?? workspace.project.name}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
            <IconVideo /> Project videos
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Review videos received by text, control their audience, and publish
            them to the correct company YouTube channel.
          </p>
        </div>
      </div>

      <ProjectVideoUpload
        projectId={workspace.project.id}
        projectNumber={workspace.project.projectNumber}
      />

      <section className="border-border mt-5 border-b pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">YouTube channels</h2>
          <Link
            href="https://www.youtube.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="Open YouTube"
          >
            <YoutubeLogo />
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {CHANNELS.map((channel) => {
            const connection = workspace.channels.find(
              (item) => item.channelKey === channel.key && item.status === "connected"
            )
            if (!connection) {
              return (
                <Button key={channel.key} asChild size="sm" variant="outline">
                  <Link
                    href={
                      `/api/google/youtube/connect?channel=${channel.key}` +
                      `&project=${encodeURIComponent(workspace.project.id)}`
                    }
                  >
                    Connect {channel.label}
                  </Link>
                </Button>
              )
            }
            return (
              <div key={channel.key} className="flex items-center gap-1">
                <Badge variant="outline">
                  {channel.label}: {connection.channelTitle}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={channelPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Disconnect ${connection.channelTitle} from Compass?`
                      )
                    ) {
                      return
                    }
                    startTransition(async () => {
                      const result = await disconnectYoutubeChannel({
                        projectId: workspace.project.id,
                        channelKey: channel.key,
                      })
                      if (!result.success) {
                        toast.error(result.error)
                        return
                      }
                      toast.success(
                        result.revoked
                          ? "YouTube access revoked and connection removed."
                          : "Connection removed. Also review Google Account permissions."
                      )
                      router.refresh()
                    })
                  }}
                >
                  Disconnect
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-6">
        {workspace.videos.length === 0 ? (
          <div className="border-border flex min-h-56 flex-col items-center justify-center border border-dashed px-6 text-center">
            <IconVideo className="text-muted-foreground size-8" />
            <h2 className="mt-3 font-medium">No project videos yet</h2>
            <p className="text-muted-foreground mt-1 max-w-lg text-sm">
              Text a video to the project with a subject or first line such as
              [Video] Railing stain demonstration.
            </p>
          </div>
        ) : (
          workspace.videos.map((video) => (
            <VideoReviewCard
              key={video.id}
              projectId={workspace.project.id}
              video={video}
              channelConnected={connectedKeys.has(video.youtubeChannelKey)}
            />
          ))
        )}
      </section>
    </main>
  )
}
