"use client"

import * as React from "react"
import {
  ExternalLink,
  Link2,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { lookupListeningTrack } from "@/app/actions/listening-track-lookup"
import type {
  ListeningQueueItemData,
  ListeningRoomSnapshot,
} from "@/app/actions/listening-room"
import { SortableList } from "@/components/sortable-list"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  formatListeningPosition,
  musicProviderLabel,
  musicProviderSearchUrl,
  normalizeMusicUrl,
  synchronizedPlaybackLink,
  type MusicProvider,
} from "@/lib/listening-room"
import { cn } from "@/lib/utils"

// Services people listen on outside Compass; offered as "Find on …" searches.
const FIND_ON_PROVIDERS: readonly MusicProvider[] = ["spotify", "apple_music"]

type LookupState =
  | { readonly status: "idle" }
  | { readonly status: "looking" }
  | { readonly status: "found" }
  | { readonly status: "failed"; readonly message: string }

/**
 * One field: paste a YouTube or SoundCloud link and Compass fills in the song
 * name and artist, which stay editable before adding.
 */
export function AddSongForm({
  busy,
  submitLabel,
  linkOptional = false,
  onSubmit,
}: {
  readonly busy: boolean
  readonly submitLabel: string
  readonly linkOptional?: boolean
  readonly onSubmit: (song: {
    readonly url: string
    readonly title: string
    readonly artist: string
  }) => Promise<boolean>
}): React.ReactElement {
  const inputId = React.useId()
  const [url, setUrl] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [artist, setArtist] = React.useState("")
  const [lookup, setLookup] = React.useState<LookupState>({ status: "idle" })

  React.useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed || !normalizeMusicUrl(trimmed)) {
      setLookup({ status: "idle" })
      return
    }
    let cancelled = false
    setLookup({ status: "looking" })
    const timer = window.setTimeout(() => {
      void lookupListeningTrack(trimmed).then((result) => {
        if (cancelled) return
        if (result.success) {
          setTitle(result.data.title)
          setArtist(result.data.artist ?? "")
          setLookup({ status: "found" })
        } else {
          setLookup({ status: "failed", message: result.error })
        }
      })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [url])

  const showDetails = lookup.status === "found" || lookup.status === "failed"
  const hasUrl = url.trim().length > 0
  const canSubmit =
    !busy &&
    lookup.status !== "looking" &&
    (hasUrl ? title.trim().length > 0 : linkOptional)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return
    const saved = await onSubmit({ url: url.trim(), title: title.trim(), artist: artist.trim() })
    if (saved) {
      setUrl("")
      setTitle("")
      setArtist("")
    }
  }

  return (
    <form className="space-y-2" onSubmit={(event) => void handleSubmit(event)}>
      <Label htmlFor={inputId}>
        {linkOptional ? "First song (optional)" : "Add a song"}
      </Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a YouTube or SoundCloud link"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={!canSubmit}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          {submitLabel}
        </Button>
      </div>
      {lookup.status === "looking" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Finding the song name…
        </p>
      ) : lookup.status === "failed" ? (
        <p className="text-xs text-muted-foreground">
          {lookup.message}. You can type the song name below.
        </p>
      ) : !showDetails ? (
        <p className="text-xs text-muted-foreground">
          Compass fills in the song name and artist from the link.
        </p>
      ) : null}
      {showDetails ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label="Song name"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Song name"
            maxLength={160}
          />
          <Input
            aria-label="Artist"
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            placeholder="Artist"
            maxLength={160}
          />
        </div>
      ) : null}
    </form>
  )
}

export function ListeningQueue({
  room,
  busy,
  onPlayNow,
  onRemove,
  onAddLink,
  onAddToPlaylist,
  onReorder,
}: {
  readonly room: ListeningRoomSnapshot
  readonly busy: boolean
  readonly onPlayNow: (track: ListeningQueueItemData) => void
  readonly onRemove: (track: ListeningQueueItemData) => void
  readonly onAddLink: (track: ListeningQueueItemData, url: string) => Promise<boolean>
  readonly onAddToPlaylist: (track: ListeningQueueItemData) => void
  readonly onReorder: (next: readonly ListeningQueueItemData[]) => void
}): React.ReactElement {
  const [linkTrackId, setLinkTrackId] = React.useState<string | null>(null)
  const [linkUrl, setLinkUrl] = React.useState("")
  const upcoming = room.queue.filter((track) => track.playedAt === null)

  // Anyone who can control playback can drag songs into a new order.
  function renderQueue(
    queue: readonly ListeningQueueItemData[],
    renderTrack: (track: ListeningQueueItemData, index: number) => React.ReactElement
  ): React.ReactElement {
    if (room.canControl) {
      return (
        <SortableList
          items={queue}
          label={(track) => track.title}
          disabled={busy}
          onReorder={onReorder}
          renderItem={renderTrack}
          className="divide-y border-y"
        />
      )
    }
    return (
      <ol className="divide-y border-y">
        {queue.map((track, index) => (
          <li key={track.id}>{renderTrack(track, index)}</li>
        ))}
      </ol>
    )
  }
  const totalMs = upcoming.reduce((sum, track) => sum + (track.durationMs ?? 0), 0)

  return (
    <section aria-labelledby="listening-queue-title" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="listening-queue-title" className="text-sm font-semibold">
          Queue
        </h3>
        <span className="text-xs text-muted-foreground">
          {upcoming.length} song{upcoming.length === 1 ? "" : "s"} left
          {totalMs > 0 ? ` · about ${Math.round(totalMs / 60_000)} min` : ""}
        </span>
      </div>
      {room.queue.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Nothing queued yet. Paste a link above to add the first song.
        </p>
      ) : (
        renderQueue(room.queue, (track, index) => {
            const current = track.id === room.currentTrackId
            const played = track.playedAt !== null && !current
            const playable = synchronizedPlaybackLink(track.links)
            const canRemove =
              track.addedBy === room.currentUserId ||
              room.hostUserId === room.currentUserId ||
              room.canModerate
            const addedBy =
              track.addedBy === room.currentUserId ? "you" : track.addedByName
            return (
              <div className="py-2">
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground",
                      current && "text-primary"
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className={cn("min-w-0 flex-1", played && "opacity-60")}>
                    <p className={cn("truncate text-sm font-medium", current && "text-primary")}>
                      {track.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        track.artist,
                        `added by ${addedBy}`,
                        current ? "playing now" : played ? "played" : null,
                        playable ? null : "no playable link",
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </p>
                  </div>
                  {track.durationMs ? (
                    <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                      {formatListeningPosition(track.durationMs)}
                    </span>
                  ) : null}
                  {room.canControl && !current && playable ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onPlayNow(track)}
                      aria-label={`Play ${track.title} now`}
                    >
                      <Play />
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`More options for ${track.title}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {track.links.map((link) => (
                        <DropdownMenuItem key={link.id} asChild>
                          <a href={link.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink /> Open in {musicProviderLabel(link.provider)}
                          </a>
                        </DropdownMenuItem>
                      ))}
                      {FIND_ON_PROVIDERS.filter(
                        (provider) => !track.links.some((link) => link.provider === provider)
                      ).map((provider) => {
                        const href = musicProviderSearchUrl({
                          provider,
                          title: track.title,
                          artist: track.artist,
                        })
                        return href ? (
                          <DropdownMenuItem key={provider} asChild>
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              <Search /> Find on {musicProviderLabel(provider)}
                            </a>
                          </DropdownMenuItem>
                        ) : null
                      })}
                      <DropdownMenuItem onSelect={() => onAddToPlaylist(track)}>
                        <ListPlus /> Add to playlist…
                      </DropdownMenuItem>
                      {room.currentUserJoined ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            setLinkTrackId(track.id)
                            setLinkUrl("")
                          }}
                        >
                          <Link2 /> Add a link from another service
                        </DropdownMenuItem>
                      ) : null}
                      {canRemove ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onRemove(track)}
                          >
                            <Trash2 />
                            {track.addedBy === room.currentUserId
                              ? "Remove my song"
                              : "Remove from queue"}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {linkTrackId === track.id ? (
                  <form
                    className="mt-2 flex gap-2 pl-8"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void onAddLink(track, linkUrl).then((saved) => {
                        if (saved) setLinkTrackId(null)
                      })
                    }}
                  >
                    <Input
                      autoFocus
                      type="url"
                      value={linkUrl}
                      onChange={(event) => setLinkUrl(event.target.value)}
                      placeholder="Paste the same song's link from another service"
                      aria-label={`Another service link for ${track.title}`}
                      required
                    />
                    <Button type="submit" size="sm" disabled={busy}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setLinkTrackId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : null}
              </div>
            )
        })
      )}
    </section>
  )
}
