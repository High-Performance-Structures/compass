"use client"

import * as React from "react"
import {
  ExternalLink,
  GripVertical,
  Headphones,
  Loader2,
  LogOut,
  Maximize2,
  Minus,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Volume2,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"
import {
  addListeningTrack,
  addListeningTrackLink,
  endListeningRoom,
  getListeningRoom,
  joinListeningRoom,
  leaveListeningRoom,
  removeListeningTrack,
  setListeningPlayback,
  startListeningRoom,
  type ListeningQueueItemData,
  type ListeningRoomSnapshot,
} from "@/app/actions/listening-room"
import { openListeningRoomWindow } from "@/components/voice/listening-room-button"
import { ListeningRoomPlayer } from "@/components/voice/listening-room-player"
import {
  AddToPlaylistDialog,
  ListeningRoomPlaylists,
} from "@/components/voice/listening-room-playlists"
import { AddSongForm, ListeningQueue } from "@/components/voice/listening-room-queue"
import { useFloatingPosition } from "@/components/voice/use-floating-position"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Slider } from "@/components/ui/slider"
import { useListeningRoomRealtime } from "@/hooks/use-listening-room-realtime"
import {
  formatListeningPosition,
  listeningPlaybackPositionMs,
  synchronizedPlaybackLink,
  youtubeThumbnailUrl,
} from "@/lib/listening-room"
import { cn } from "@/lib/utils"

const VOLUME_STORAGE_KEY = "compass-listening-volume"
const DEFAULT_VOLUME = 70
const MINI_PLAYER_POSITION_KEY = "compass-listening-mini-position"

type SnapshotResult =
  | { readonly success: true; readonly data: ListeningRoomSnapshot }
  | { readonly success: false; readonly error: string }

type PlaybackCommand = "play" | "pause" | "skip" | "restart"

function readVolume(): number {
  try {
    const saved = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY))
    return Number.isFinite(saved) && saved > 0 && saved <= 100 ? saved : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function saveVolume(volume: number): void {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
  } catch {
    // Volume falls back to the default next time.
  }
}

function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?"
}

/** Elapsed time that ticks locally between room updates. */
function useRoomPosition(room: ListeningRoomSnapshot | null): number {
  const [, setTick] = React.useState(0)
  const offsetMs = React.useMemo(() => {
    const serverTime = room ? Date.parse(room.serverTime) : Number.NaN
    return Number.isFinite(serverTime) ? serverTime - Date.now() : 0
  }, [room])
  const playing = room?.playbackState === "playing"
  React.useEffect(() => {
    if (!playing) return
    const interval = window.setInterval(() => setTick((tick) => tick + 1), 1_000)
    return () => window.clearInterval(interval)
  }, [playing])
  if (!room) return 0
  return listeningPlaybackPositionMs({
    state: room.playbackState,
    anchorPositionMs: room.anchorPositionMs,
    playbackStartedAt: room.playbackStartedAt,
    nowMs: Date.now() + offsetMs,
  })
}

export function ListeningRoom({
  channelId,
  channelName,
  expanded,
  onExpandedChange,
  onJoinedChange,
  onDismiss,
  standalone = false,
}: {
  readonly channelId: string
  readonly channelName: string
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onJoinedChange?: (joined: boolean) => void
  /** Removes the room from the page entirely (not just the mini player). */
  readonly onDismiss: () => void
  /** The pop-out window: always full size, with nothing to pop out to. */
  readonly standalone?: boolean
}): React.ReactElement | null {
  const [room, setRoom] = React.useState<ListeningRoomSnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [tab, setTab] = React.useState<"room" | "playlists">("room")
  const [audioEnabled, setAudioEnabled] = React.useState(false)
  const [volume, setVolume] = React.useState(DEFAULT_VOLUME)
  const [durations, setDurations] = React.useState<Readonly<Record<string, number>>>({})
  const [closeConfirmationOpen, setCloseConfirmationOpen] = React.useState(false)
  const [playlistSong, setPlaylistSong] = React.useState<ListeningQueueItemData | null>(null)
  const loadingRoomRef = React.useRef(false)
  const full = standalone || expanded
  const floating = useFloatingPosition<HTMLElement>(MINI_PLAYER_POSITION_KEY, !full)

  React.useEffect(() => setVolume(readVolume()), [])

  const loadRoom = React.useCallback(async (): Promise<void> => {
    if (loadingRoomRef.current) return
    loadingRoomRef.current = true
    try {
      const result = await getListeningRoom(channelId)
      if (result.success) setRoom(result.data.room)
      setLoading(false)
    } finally {
      loadingRoomRef.current = false
    }
  }, [channelId])

  React.useEffect(() => {
    void loadRoom()
    const interval = window.setInterval(() => void loadRoom(), full ? 30_000 : 60_000)
    const refreshVisibleRoom = (): void => {
      if (document.visibilityState === "visible") void loadRoom()
    }
    window.addEventListener("focus", refreshVisibleRoom)
    document.addEventListener("visibilitychange", refreshVisibleRoom)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshVisibleRoom)
      document.removeEventListener("visibilitychange", refreshVisibleRoom)
    }
  }, [loadRoom, full])

  const joined = Boolean(room?.currentUserJoined)
  React.useEffect(() => {
    if (!loading) onJoinedChange?.(joined)
  }, [joined, loading, onJoinedChange])

  // Collapsed without having joined there is nothing to show; close the dock.
  React.useEffect(() => {
    if (!loading && !full && !joined) onDismiss()
  }, [loading, full, joined, onDismiss])

  const realtime = useListeningRoomRealtime({
    channelId,
    enabled: joined,
    onRoomChanged: () => void loadRoom(),
  })
  const positionMs = useRoomPosition(room)

  async function applySnapshot(
    promise: Promise<SnapshotResult>,
    successMessage?: string
  ): Promise<ListeningRoomSnapshot | null> {
    setBusy(true)
    try {
      const result = await promise
      if (!result.success) {
        toast.error(result.error)
        return null
      }
      setRoom(result.data)
      realtime.notifyRoomChanged()
      if (successMessage) toast.success(successMessage)
      return result.data
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Listening Room update failed")
      return null
    } finally {
      setBusy(false)
    }
  }

  function command(next: PlaybackCommand): Promise<ListeningRoomSnapshot | null> {
    return applySnapshot(setListeningPlayback({ channelId, command: next }))
  }

  async function handleJoin(): Promise<void> {
    // This click is the browser's permission to play sound on this page.
    setAudioEnabled(true)
    await applySnapshot(joinListeningRoom({ channelId, preferredProvider: "youtube" }))
  }

  async function handleAddSong(song: {
    readonly url: string
    readonly title: string
    readonly artist: string
  }): Promise<boolean> {
    const wasEmpty = room ? room.queue.every((track) => track.playedAt !== null) : true
    const updated = await applySnapshot(
      addListeningTrack({ channelId, title: song.title, artist: song.artist, url: song.url }),
      "Added to the queue"
    )
    if (!updated) return false
    // The first song in a quiet room starts right away.
    if (wasEmpty && updated.playbackState !== "playing") await command("play")
    return true
  }

  async function handleStart(song: {
    readonly url: string
    readonly title: string
    readonly artist: string
  }): Promise<boolean> {
    setAudioEnabled(true)
    const started = await applySnapshot(startListeningRoom(channelId))
    if (!started) return false
    await applySnapshot(joinListeningRoom({ channelId, preferredProvider: "youtube" }))
    if (!song.url) return true
    const added = await applySnapshot(
      addListeningTrack({ channelId, title: song.title, artist: song.artist, url: song.url })
    )
    if (added) await command("play")
    return Boolean(added)
  }

  async function handleLeave(): Promise<void> {
    setBusy(true)
    try {
      const result = await leaveListeningRoom(channelId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      realtime.notifyRoomChanged()
      setRoom(result.data.room)
      setAudioEnabled(false)
      toast.success("You left the Listening Room")
      if (standalone) window.close()
      else onDismiss()
    } finally {
      setBusy(false)
    }
  }

  async function handleEndRoom(): Promise<void> {
    setBusy(true)
    try {
      const result = await endListeningRoom(channelId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      realtime.notifyRoomChanged()
      setRoom(null)
      setAudioEnabled(false)
      toast.success("Listening Room closed")
    } finally {
      setBusy(false)
    }
  }

  function handlePopOut(): void {
    openListeningRoomWindow(channelId)
    // The pop-out takes over playback so the music never plays twice.
    onDismiss()
  }

  const currentTrack = room?.queue.find((track) => track.id === room.currentTrackId) ?? null
  const playbackLink = currentTrack ? synchronizedPlaybackLink(currentTrack.links) : null
  const durationMs = currentTrack
    ? durations[currentTrack.id] ?? currentTrack.durationMs
    : null
  const playing = room?.playbackState === "playing"
  const canClose = room ? room.hostUserId === room.currentUserId || room.canModerate : false
  // The player keeps this in a ref, so it does not need to be stable.
  function handleDuration(milliseconds: number): void {
    if (!currentTrack || !Number.isFinite(milliseconds) || milliseconds <= 0) return
    const trackId = currentTrack.id
    setDurations((previous) => ({ ...previous, [trackId]: milliseconds }))
  }

  if (!full && !joined) return null

  const compact = !full
  const artwork = playbackLink ? youtubeThumbnailUrl(playbackLink.url) : null

  // The player sits first in the Now Playing block in both sizes, so switching
  // between the mini player and the full room never restarts the music.
  const playerSlot = !room || !currentTrack ? null : joined && playbackLink ? (
    <div className={cn("shrink-0", compact ? "" : "w-full")}>
      <ListeningRoomPlayer
        channelId={channelId}
        clock={room}
        trackId={currentTrack.id}
        link={playbackLink}
        audioEnabled={audioEnabled}
        onEnableAudio={() => setAudioEnabled(true)}
        volume={volume}
        compact={compact}
        onDuration={handleDuration}
        onEnded={() =>
          void applySnapshot(
            setListeningPlayback({ channelId, command: "advance", queueItemId: currentTrack.id })
          )
        }
      />
    </div>
  ) : (
    <div
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground",
        compact ? "h-16 w-28" : "aspect-video w-full"
      )}
    >
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote video thumbnail
        <img src={artwork} alt="" className="size-full object-cover" />
      ) : (
        <Music2 className="size-8" />
      )}
    </div>
  )

  const progress = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : null
  const progressBar = (
    <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <span>{formatListeningPosition(positionMs)}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress ?? 0}%` }}
        />
      </div>
      <span>{durationMs ? formatListeningPosition(durationMs) : "--:--"}</span>
    </div>
  )

  const playPauseButton = (
    <Button
      type="button"
      size={compact ? "icon" : "icon-lg"}
      className="rounded-full"
      disabled={busy || !room || room.queue.length === 0}
      onClick={() => void command(playing ? "pause" : "play")}
      aria-label={playing ? "Pause for everyone" : "Play for everyone"}
    >
      {playing ? <Pause /> : <Play />}
    </Button>
  )

  const nowPlaying = room && currentTrack ? (
    <section
      aria-label="Now playing"
      className={cn(compact ? "space-y-2" : "space-y-3", full && tab !== "room" && "hidden")}
    >
      <div className={cn(compact ? "flex items-center gap-3" : "space-y-3")}>
        {playerSlot}
        <div className="min-w-0 flex-1">
          {!compact ? (
            <p className="text-xs font-medium tracking-wide text-primary uppercase">
              Now playing{playbackLink ? ` · ${playbackLink.provider === "youtube" ? "YouTube" : "SoundCloud"}` : ""}
            </p>
          ) : null}
          <p className={cn("truncate font-semibold", compact ? "text-sm" : "text-lg")}>
            {currentTrack.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              currentTrack.artist,
              compact
                ? `${room.participants.length} listening`
                : `added by ${currentTrack.addedBy === room.currentUserId ? "you" : currentTrack.addedByName}`,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
          {!playbackLink && !compact ? (
            <p className="mt-1 text-xs text-muted-foreground">
              This song has no YouTube or SoundCloud link, so it can&apos;t play here. Skip it or open it from the queue.
            </p>
          ) : null}
        </div>
        {compact ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {playPauseButton}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => onExpandedChange(true)}
              aria-label="Open the Listening Room"
            >
              <Maximize2 />
            </Button>
          </div>
        ) : null}
      </div>
      {progressBar}
      {!compact && joined ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="rounded-full"
            disabled={busy}
            onClick={() => void command("restart")}
            aria-label="Restart this song for everyone"
          >
            <RotateCcw />
          </Button>
          {playPauseButton}
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="rounded-full"
            disabled={busy}
            onClick={() => void command("skip")}
            aria-label="Skip to the next song for everyone"
          >
            <SkipForward />
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Volume2 className="size-4 text-muted-foreground" aria-hidden="true" />
            <Slider
              className="w-28"
              min={0}
              max={100}
              step={1}
              value={[volume]}
              onValueChange={(value) => {
                const next = value[0] ?? DEFAULT_VOLUME
                setVolume(next)
                saveVolume(next)
              }}
              aria-label="Your volume"
            />
          </div>
        </div>
      ) : null}
      {!compact && joined ? (
        <p className="text-xs text-muted-foreground">
          Play, pause and skip change the music for everyone. Volume is just for you.
        </p>
      ) : null}
    </section>
  ) : null

  return (
    <>
      <aside
        ref={floating.elementRef}
        aria-label={compact ? "Listening Room mini player" : "Listening Room"}
        style={compact ? floating.style : undefined}
        className={cn(
          "bg-background",
          standalone
            ? "flex h-dvh w-full flex-col"
            : compact
              ? cn(
                  "fixed right-3 bottom-20 z-50 w-[calc(100%-1.5rem)] rounded-lg border py-3 pr-3 pl-9 shadow-xl sm:w-[24rem] md:bottom-3",
                  floating.dragging && "shadow-2xl select-none"
                )
              : // Same frame as the Ask Jarvis panel: beside the page on desktop,
                // full screen on phones.
                "fixed inset-0 z-50 flex flex-col md:relative md:inset-auto md:z-auto md:my-2 md:mr-2 md:w-[26rem] md:shrink-0 md:overflow-hidden md:rounded-lg md:border md:shadow-lg"
        )}
      >
        {/* Children keep fixed slots (null when hidden) so the player inside
            Now Playing is never remounted when the room is minimized. */}
        {compact ? (
          <button
            type="button"
            {...floating.handleProps}
            aria-label="Move the mini player (drag, or use the arrow keys; double-click to put it back)"
            title="Drag to move · double-click to put it back"
            className={cn(
              "absolute inset-y-0 left-0 flex w-7 touch-none items-center justify-center rounded-l-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              floating.dragging ? "cursor-grabbing bg-muted" : "cursor-grab"
            )}
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        {compact ? null : <header className="flex items-center gap-3 border-b bg-sidebar px-4 py-3 text-sidebar-foreground">
          <Music2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Listening Room</h2>
            <p className="flex items-center gap-1.5 truncate text-xs text-sidebar-foreground/70">
              {channelName}
              {room ? ` · ${room.participants.length} listening` : ""}
              {realtime.status === "connected" ? (
                <>
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                  In sync
                </>
              ) : null}
            </p>
          </div>
          {room && room.participants.length > 0 ? (
            <div className="hidden -space-x-2 sm:flex" aria-hidden="true">
              {room.participants.slice(0, 4).map((participant) => (
                <span
                  key={participant.userId}
                  title={participant.displayName}
                  className="grid size-7 place-items-center rounded-full border-2 border-sidebar bg-sidebar-accent text-xs font-semibold"
                >
                  {initials(participant.displayName)}
                </span>
              ))}
            </div>
          ) : null}
          {room ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="text-sidebar-foreground hover:bg-sidebar-accent"
                  aria-label="Listening Room options"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {!standalone ? (
                  <DropdownMenuItem onSelect={handlePopOut}>
                    <ExternalLink /> Pop out into its own window
                  </DropdownMenuItem>
                ) : null}
                {joined ? (
                  <DropdownMenuItem onSelect={() => void handleLeave()}>
                    <LogOut /> Leave the room
                  </DropdownMenuItem>
                ) : null}
                {canClose ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setCloseConfirmationOpen(true)}
                    >
                      <XCircle /> Close the room for everyone
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {!standalone ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={() => (joined ? onExpandedChange(false) : onDismiss())}
              aria-label={joined ? "Minimize to the mini player" : "Close the Listening Room"}
            >
              <Minus />
            </Button>
          ) : null}
        </header>}

        {room && !compact ? (
          <nav className="flex gap-1 border-b px-4" role="tablist" aria-label="Listening Room sections">
            {(["room", "playlists"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "border-b-2 px-3 pt-3 pb-2 text-sm font-medium transition-colors",
                  tab === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {value === "room" ? "Room" : "Playlists"}
              </button>
            ))}
          </nav>
        ) : null}

        <div className={compact ? "space-y-2" : "flex-1 space-y-5 overflow-y-auto p-4"}>
          {compact ? null : loading ? (
            <p className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Loading the room
            </p>
          ) : !room ? (
            <div className="space-y-5 py-6 text-center">
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-primary/10">
                <Music2 className="size-7 text-primary" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold">{channelName} is quiet</p>
                <p className="text-sm text-muted-foreground">
                  Start the music and everyone in {channelName} can listen along.
                </p>
              </div>
              <div className="text-left">
                <AddSongForm
                  busy={busy}
                  linkOptional
                  submitLabel="Start the music"
                  onSubmit={handleStart}
                />
              </div>
            </div>
          ) : null}
          {nowPlaying}
          {compact ? (
            currentTrack ? null : (
              <div className="flex items-center gap-3">
                <Music2 className="size-5 text-primary" aria-hidden="true" />
                <p className="flex-1 text-sm text-muted-foreground">Nothing playing right now</p>
                <Button type="button" size="sm" variant="outline" onClick={() => onExpandedChange(true)}>
                  Open room
                </Button>
              </div>
            )
          ) : room ? (
            <>
              {tab === "room" ? (
                <>
                  {!currentTrack ? (
                    <p className="text-sm text-muted-foreground">
                      {room.queue.length > 0
                        ? "The queue has finished. Press play to start it again, or add a song."
                        : "Nothing is playing yet. Add a song to get started."}
                    </p>
                  ) : null}
                  {!joined ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                      <p className="text-sm text-muted-foreground">
                        {room.hostDisplayName} started this room. Join to hear it with everyone.
                      </p>
                      <Button type="button" disabled={busy} onClick={() => void handleJoin()}>
                        <Headphones /> Join &amp; listen
                      </Button>
                    </div>
                  ) : (
                    <>
                      {!currentTrack && room.queue.length > 0 ? (
                        <div>{playPauseButton}</div>
                      ) : null}
                      <AddSongForm busy={busy} submitLabel="Add" onSubmit={handleAddSong} />
                    </>
                  )}
                  <ListeningQueue
                    room={room}
                    busy={busy}
                    onPlayNow={(track: ListeningQueueItemData) =>
                      void applySnapshot(
                        setListeningPlayback({ channelId, command: "jump", queueItemId: track.id })
                      )
                    }
                    onRemove={(track) =>
                      void applySnapshot(
                        removeListeningTrack({ channelId, queueItemId: track.id }),
                        "Removed from the queue"
                      )
                    }
                    onAddToPlaylist={setPlaylistSong}
                    onAddLink={async (track, url) =>
                      Boolean(
                        await applySnapshot(
                          addListeningTrackLink({ channelId, queueItemId: track.id, url }),
                          "Link saved"
                        )
                      )
                    }
                  />
                </>
              ) : (
                <ListeningRoomPlaylists
                  channelId={channelId}
                  currentQueueCount={room.queue.length}
                  canControl={room.canControl}
                  onQueueChanged={() => {
                    realtime.notifyRoomChanged()
                    void loadRoom()
                    setTab("room")
                  }}
                />
              )}
            </>
          ) : null}
        </div>
      </aside>

      <AddToPlaylistDialog
        channelId={channelId}
        song={playlistSong}
        onClose={() => setPlaylistSong(null)}
      />

      <AlertDialog open={closeConfirmationOpen} onOpenChange={setCloseConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close the Listening Room for everyone?</AlertDialogTitle>
            <AlertDialogDescription>
              The music stops and the queue is cleared for everyone in {channelName}.
              Saved playlists are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleEndRoom()}
            >
              Close the room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
