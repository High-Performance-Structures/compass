"use client"

import * as React from "react"
import {
  ExternalLink,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  SkipForward,
  Trash2,
  Users,
  X,
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
  removeListeningTrackLink,
  setListeningPlayback,
  startListeningRoom,
  type ListeningQueueItemData,
  type ListeningRoomSnapshot,
} from "@/app/actions/listening-room"
import { ListeningRoomPlayer } from "@/components/voice/listening-room-player"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  MUSIC_PROVIDERS,
  SYNCHRONIZED_MUSIC_PROVIDERS,
  findPreferredMusicLink,
  formatListeningPosition,
  isMusicProvider,
  musicPlaybackTarget,
  musicProviderLabel,
  synchronizedProviderLabel,
  type MusicProvider,
} from "@/lib/listening-room"
import { cn } from "@/lib/utils"
import { useListeningRoomRealtime } from "@/hooks/use-listening-room-realtime"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const PREFERRED_PROVIDER_KEY = "compass-listening-provider"

type SnapshotResult =
  | { readonly success: true; readonly data: ListeningRoomSnapshot }
  | { readonly success: false; readonly error: string }

export function ListeningRoomButton({
  channelId,
  channelName,
  className,
}: {
  readonly channelId: string
  readonly channelName: string
  readonly className?: string
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [room, setRoom] = React.useState<ListeningRoomSnapshot | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [closeConfirmationOpen, setCloseConfirmationOpen] = React.useState(false)
  const [preferredProvider, setPreferredProvider] =
    React.useState<MusicProvider | null>("youtube")
  const [title, setTitle] = React.useState("")
  const [artist, setArtist] = React.useState("")
  const [trackUrl, setTrackUrl] = React.useState("")
  const [linkTrackId, setLinkTrackId] = React.useState<string | null>(null)
  const [alternateUrl, setAlternateUrl] = React.useState("")
  const loadingRoomRef = React.useRef(false)

  const loadRoom = React.useCallback(async (showError: boolean): Promise<void> => {
    if (loadingRoomRef.current) return
    loadingRoomRef.current = true
    try {
      const result = await getListeningRoom(channelId)
      if (result.success) {
        setRoom(result.data.room)
      } else if (showError) {
        toast.error(result.error)
      }
      setLoading(false)
    } finally {
      loadingRoomRef.current = false
    }
  }, [channelId])

  React.useEffect(() => {
    const saved = window.localStorage.getItem(PREFERRED_PROVIDER_KEY)
    if (saved && isMusicProvider(saved)) setPreferredProvider(saved)
  }, [])

  React.useEffect(() => {
    void loadRoom(false)
    const interval = window.setInterval(
      () => void loadRoom(false),
      open ? 30_000 : 60_000
    )
    return () => window.clearInterval(interval)
  }, [loadRoom, open])

  React.useEffect(() => {
    const refreshVisibleRoom = (): void => {
      if (document.visibilityState === "visible") void loadRoom(false)
    }
    window.addEventListener("focus", refreshVisibleRoom)
    document.addEventListener("visibilitychange", refreshVisibleRoom)
    return () => {
      window.removeEventListener("focus", refreshVisibleRoom)
      document.removeEventListener("visibilitychange", refreshVisibleRoom)
    }
  }, [loadRoom])

  const realtime = useListeningRoomRealtime({
    channelId,
    enabled: Boolean(room?.currentUserJoined),
    onRoomChanged: () => void loadRoom(false),
  })

  async function applySnapshot(
    promise: Promise<SnapshotResult>,
    successMessage?: string
  ): Promise<boolean> {
    setBusy(true)
    try {
      const result = await promise
      if (!result.success) {
        toast.error(result.error)
        return false
      }
      setRoom(result.data)
      realtime.notifyRoomChanged()
      if (successMessage) toast.success(successMessage)
      return true
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Listening room update failed"
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleStart(): Promise<void> {
    await applySnapshot(startListeningRoom(channelId), "Listening room started")
  }

  async function handleJoin(): Promise<void> {
    if (preferredProvider === null) {
      toast.error("Choose your music service before joining")
      return
    }
    await applySnapshot(
      joinListeningRoom({ channelId, preferredProvider }),
      "You joined the listening room"
    )
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
      toast.success("You left the listening room")
    } finally {
      setBusy(false)
    }
  }

  async function handleProviderChange(value: string): Promise<void> {
    if (!isMusicProvider(value)) return
    setPreferredProvider(value)
    window.localStorage.setItem(PREFERRED_PROVIDER_KEY, value)
    if (room?.currentUserJoined) {
      await applySnapshot(
        joinListeningRoom({ channelId, preferredProvider: value })
      )
    }
  }

  async function handleAddTrack(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const saved = await applySnapshot(
      addListeningTrack({ channelId, title, artist, url: trackUrl }),
      "Track added to the queue"
    )
    if (saved) {
      setTitle("")
      setArtist("")
      setTrackUrl("")
    }
  }

  async function handleAddLink(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!linkTrackId) return
    const saved = await applySnapshot(
      addListeningTrackLink({
        channelId,
        queueItemId: linkTrackId,
        url: alternateUrl,
      }),
      "Service link saved"
    )
    if (saved) {
      setLinkTrackId(null)
      setAlternateUrl("")
    }
  }

  function openTrack(track: ListeningQueueItemData): void {
    if (preferredProvider === null) {
      toast.error("Choose your music service first")
      return
    }
    const target = musicPlaybackTarget({
      links: track.links,
      preferredProvider,
      title: track.title,
      artist: track.artist,
    })
    if (!target) {
      if (room?.currentUserJoined) setLinkTrackId(track.id)
      toast.info(
        room?.currentUserJoined
          ? `Add an exact ${musicProviderLabel(preferredProvider)} link below, or choose an available service.`
          : `No ${musicProviderLabel(preferredProvider)} link is available. Choose an available service.`
      )
      return
    }
    window.open(target.url, "_blank", "noopener,noreferrer")
    if (target.kind === "search") {
      toast.info(`Showing ${musicProviderLabel(preferredProvider)} results for this track`)
    }
  }

  const currentTrack = room?.queue.find(
    (track) => track.id === room.currentTrackId
  ) ?? null
  const orderedProviders = [
    ...SYNCHRONIZED_MUSIC_PROVIDERS,
    ...MUSIC_PROVIDERS.filter(
      (provider) =>
        !SYNCHRONIZED_MUSIC_PROVIDERS.some(
          (synchronizedProvider) => synchronizedProvider === provider
        )
    ),
  ]

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "relative flex size-7 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
              room && "border-primary/60 bg-primary/15 text-primary",
              className
            )}
            aria-label="Open listening room"
          >
            <Music2 className="size-4" />
            {room?.playbackState === "playing" ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {room ? "Listening Room" : "Start a Listening Room"}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="size-5 text-primary" />
              Listening Room · {channelName}
            </DialogTitle>
            <DialogDescription>
              YouTube and SoundCloud play together inside Compass. Other services
              remain available as clearly marked links while their playback
              integrations are developed.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex min-h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading room
            </div>
          ) : !room ? (
            <div className="space-y-5 py-4 text-center">
              <Music2 className="mx-auto size-10 text-muted-foreground" />
              <div>
                <p className="font-medium">The office is quiet right now.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start a room, add a YouTube or SoundCloud track, and invite the
                  channel to listen along.
                </p>
              </div>
              <Button type="button" onClick={() => void handleStart()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Radio />}
                Start listening room
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    Hosted by {room.hostDisplayName}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="size-3.5" />
                    {room.participants.length} listening
                    <span aria-hidden="true">·</span>
                    <span>
                      {realtime.status === "connected"
                        ? "Live sync connected"
                        : realtime.status === "reconnecting"
                          ? "Reconnecting sync"
                          : "Sync starts after joining"}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={preferredProvider ?? undefined}
                    onValueChange={(value) => void handleProviderChange(value)}
                  >
                    <SelectTrigger size="sm" aria-label="Preferred music service">
                      <SelectValue placeholder="Choose service" />
                    </SelectTrigger>
                    <SelectContent>
                      {orderedProviders.map((provider) => (
                        <SelectItem key={provider} value={provider}>
                          {musicProviderLabel(provider)} · {synchronizedProviderLabel(provider)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {room.currentUserJoined ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleLeave()}
                      disabled={busy}
                    >
                      <LogOut /> Leave
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleJoin()}
                      disabled={busy || preferredProvider === null}
                    >
                      <LogIn /> Join
                    </Button>
                  )}
                </div>
              </div>

              <section aria-labelledby="now-playing-title">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p id="now-playing-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Now playing
                    </p>
                    {currentTrack ? (
                      <>
                        <p className="truncate font-medium">{currentTrack.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {currentTrack.artist ?? `Added by ${currentTrack.addedByName}`}
                          {room.playbackState === "playing"
                            ? ` · ${formatListeningPosition(room.positionMs)}`
                            : " · Paused"}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Queue a track to get started.</p>
                    )}
                  </div>
                </div>
                {currentTrack && preferredProvider ? (
                  <ListeningRoomPlayer
                    clock={room}
                    track={currentTrack}
                    provider={preferredProvider}
                    joined={room.currentUserJoined}
                    onAddProviderLink={() => setLinkTrackId(currentTrack.id)}
                    onEnded={() => {
                      if (room.currentUserId !== room.hostUserId) return
                      void applySnapshot(
                        setListeningPlayback({ channelId, command: "skip" })
                      )
                    }}
                  />
                ) : null}
                {room.canControl ? (
                  <div className="flex gap-2 border-t pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !currentTrack}
                      onClick={() => void applySnapshot(setListeningPlayback({
                        channelId,
                        command: room.playbackState === "playing" ? "pause" : "play",
                      }))}
                    >
                      {room.playbackState === "playing" ? <Pause /> : <Play />}
                      {room.playbackState === "playing" ? "Pause room" : "Play room"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !currentTrack}
                      onClick={() => void applySnapshot(setListeningPlayback({ channelId, command: "restart" }))}
                    >
                      <RotateCcw /> Restart
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !currentTrack}
                      onClick={() => void applySnapshot(setListeningPlayback({ channelId, command: "skip" }))}
                    >
                      <SkipForward /> Skip
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="border-t pt-4" aria-labelledby="queue-title">
                <div className="mb-2 flex items-center justify-between">
                  <h3 id="queue-title" className="text-sm font-semibold">Shared queue</h3>
                  <span className="text-xs text-muted-foreground">
                    {room.queue.length} track{room.queue.length === 1 ? "" : "s"}
                  </span>
                </div>
                {room.queue.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No tracks yet.</p>
                ) : (
                  <ol className="divide-y">
                    {room.queue.map((track) => {
                      const selectedLink = findPreferredMusicLink(
                        track.links,
                        preferredProvider
                      )
                      const canRemove =
                        track.addedBy === room.currentUserId || room.canControl
                      return (
                        <li key={track.id} className="py-3">
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => openTrack(track)}
                            >
                              <span className={cn(
                                "block truncate text-sm font-medium",
                                track.id === room.currentTrackId && "text-primary"
                              )}>
                                {track.title}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {track.artist ?? "Unknown artist"} · {track.links.length > 0
                                  ? track.links.map((link) => musicProviderLabel(link.provider)).join(", ")
                                  : "Needs a service link"}
                              </span>
                            </button>
                            {selectedLink ? (
                              <Button type="button" size="icon-xs" variant="ghost" onClick={() => openTrack(track)} aria-label={`Open ${track.title}`}>
                                <ExternalLink />
                              </Button>
                            ) : null}
                            {room.currentUserJoined ? (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => {
                                  setLinkTrackId(linkTrackId === track.id ? null : track.id)
                                  setAlternateUrl("")
                                }}
                                aria-label={`Add a service link for ${track.title}`}
                              >
                                <Link2 />
                              </Button>
                            ) : null}
                            {canRemove ? (
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                onClick={() => void applySnapshot(removeListeningTrack({ channelId, queueItemId: track.id }), "Track removed")}
                                aria-label={`Remove ${track.title}`}
                              >
                                <Trash2 />
                              </Button>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {track.links.map((link) => {
                              const canRemoveLink =
                                track.links.length > 1 &&
                                (link.addedBy === room.currentUserId || canRemove)
                              return (
                                <div
                                  key={link.id}
                                  className="flex items-center border bg-muted/30"
                                >
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="px-2 py-1 text-xs hover:underline"
                                  >
                                    {musicProviderLabel(link.provider)}
                                  </a>
                                  {canRemoveLink ? (
                                    <button
                                      type="button"
                                      className="border-l p-1 text-muted-foreground hover:text-destructive"
                                      onClick={() =>
                                        void applySnapshot(
                                          removeListeningTrackLink({
                                            channelId,
                                            linkId: link.id,
                                          }),
                                          "Service link removed"
                                        )
                                      }
                                      aria-label={`Remove ${musicProviderLabel(link.provider)} link for ${track.title}`}
                                    >
                                      <X className="size-3" />
                                    </button>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                          {room.currentUserJoined && linkTrackId === track.id ? (
                            <form className="mt-2 flex gap-2" onSubmit={(event) => void handleAddLink(event)}>
                              <Input
                                value={alternateUrl}
                                onChange={(event) => setAlternateUrl(event.target.value)}
                                placeholder={
                                  preferredProvider
                                    ? `Optional exact ${musicProviderLabel(preferredProvider)} link`
                                    : "Paste a link from another service"
                                }
                                aria-label={`Alternate service link for ${track.title}`}
                                required
                              />
                              <Button type="submit" size="sm" disabled={busy}>
                                Save
                              </Button>
                            </form>
                          ) : null}
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>

              {room.currentUserJoined ? (
                <form className="space-y-3 border-t pt-4" onSubmit={(event) => void handleAddTrack(event)}>
                  <div>
                    <h3 className="text-sm font-semibold">Add to the queue</h3>
                    <p className="text-xs text-muted-foreground">
                      Add an exact YouTube or SoundCloud track link for synchronized
                      playback. Everyone can contribute to the queue.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="listening-track-title">Track title</Label>
                      <Input id="listening-track-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="listening-track-artist">Artist</Label>
                      <Input id="listening-track-artist" value={artist} onChange={(event) => setArtist(event.target.value)} maxLength={160} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input value={trackUrl} onChange={(event) => setTrackUrl(event.target.value)} placeholder="Paste a YouTube or SoundCloud track link" aria-label="Music service link" />
                    <Button type="submit" disabled={busy || !title.trim()}>
                      <Plus /> Add
                    </Button>
                  </div>
                </form>
              ) : null}

              {room.canControl ? (
                <div className="border-t pt-4">
                  <Button type="button" variant="destructive" size="sm" onClick={() => setCloseConfirmationOpen(true)}>
                    Close listening room
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={closeConfirmationOpen} onOpenChange={setCloseConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this listening room?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the shared queue and participation list for everyone in
              {` ${channelName}`}. Music already open in another service is unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep room open</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    const result = await endListeningRoom(channelId)
                    if (!result.success) {
                      toast.error(result.error)
                      return
                    }
                    realtime.notifyRoomChanged()
                    setRoom(null)
                    setOpen(false)
                    toast.success("Listening room closed")
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Close room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
