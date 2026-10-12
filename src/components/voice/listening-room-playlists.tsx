"use client"

import * as React from "react"
import {
  ArrowLeft,
  ChevronRight,
  FolderInput,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import {
  addSongToListeningPlaylist,
  createEmptyListeningPlaylist,
  moveListeningPlaylistSong,
  removeListeningPlaylistSong,
} from "@/app/actions/listening-playlist-items"
import {
  addListeningPlaylistToRoom,
  createListeningPlaylist,
  deleteListeningPlaylist,
  getListeningPlaylists,
  renameListeningPlaylist,
  replaceListeningPlaylistFromQueue,
  type ListeningPlaylistData,
} from "@/app/actions/listening-playlists"
import { AddSongForm } from "@/components/voice/listening-room-queue"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"

type Playlist = ListeningPlaylistData
type PlaylistSong = Playlist["items"][number]

function songCount(count: number): string {
  return `${count} song${count === 1 ? "" : "s"}`
}

function usePlaylists(channelId: string): {
  readonly playlists: readonly Playlist[]
  readonly loading: boolean
  readonly reload: () => Promise<void>
} {
  const [playlists, setPlaylists] = React.useState<readonly Playlist[]>([])
  const [loading, setLoading] = React.useState(true)
  const reload = React.useCallback(async (): Promise<void> => {
    const result = await getListeningPlaylists(channelId)
    if (result.success) setPlaylists(result.data.playlists)
    else toast.error(result.error)
    setLoading(false)
  }, [channelId])
  React.useEffect(() => {
    void reload()
  }, [reload])
  return { playlists, loading, reload }
}

/** Name a playlist: either empty or saved from the room's current queue. */
function NewPlaylistForm({
  busy,
  canSaveQueue,
  onCreate,
  onCancel,
}: {
  readonly busy: boolean
  readonly canSaveQueue: boolean
  readonly onCreate: (name: string, fromQueue: boolean) => Promise<void>
  readonly onCancel: () => void
}): React.ReactElement {
  const [name, setName] = React.useState("")
  const [fromQueue, setFromQueue] = React.useState(false)
  return (
    <form
      className="space-y-2 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) void onCreate(name.trim(), fromQueue)
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Playlist name"
        aria-label="New playlist name"
        maxLength={120}
        required
      />
      {canSaveQueue ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fromQueue}
            onChange={(event) => setFromQueue(event.target.checked)}
            className="size-4 accent-primary"
          />
          Start it with the songs in the room&apos;s queue
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          Create playlist
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ListeningRoomPlaylists({
  channelId,
  currentQueueCount,
  canControl,
  onQueueChanged,
}: {
  readonly channelId: string
  readonly currentQueueCount: number
  readonly canControl: boolean
  readonly onQueueChanged: () => void
}): React.ReactElement {
  const { playlists, loading, reload } = usePlaylists(channelId)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [replaceConfirmationOpen, setReplaceConfirmationOpen] = React.useState(false)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = React.useState(false)

  const selected = playlists.find((playlist) => playlist.id === selectedId) ?? null
  const moveTargets = playlists.filter(
    (playlist) => playlist.canEdit && playlist.id !== selected?.id
  )

  async function run<T>(
    promise: Promise<{ readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }>,
    successMessage?: string
  ): Promise<T | null> {
    setBusy(true)
    try {
      const result = await promise
      if (!result.success) {
        toast.error(result.error)
        return null
      }
      if (successMessage) toast.success(successMessage)
      return result.data
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(name: string, fromQueue: boolean): Promise<void> {
    const created = await run(
      fromQueue
        ? createListeningPlaylist({ channelId, name })
        : createEmptyListeningPlaylist({ channelId, name }),
      "Playlist created"
    )
    if (!created) return
    setCreating(false)
    await reload()
    setSelectedId(created.playlistId)
  }

  async function handlePlay(playlist: Playlist, startAt: PlaylistSong | null): Promise<void> {
    const result = await run(
      addListeningPlaylistToRoom({
        channelId,
        playlistId: playlist.id,
        ...(startAt ? { startAtItemId: startAt.id } : {}),
      })
    )
    if (!result) return
    onQueueChanged()
    toast.success(
      startAt ? `Playing ${startAt.title}` : `${songCount(result.addedCount)} added to the queue`
    )
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading playlists
      </p>
    )
  }

  if (!selected) {
    return (
      <section aria-labelledby="playlists-title" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="playlists-title" className="flex items-center gap-2 text-sm font-semibold">
            <ListMusic className="size-4" /> Team playlists
          </h3>
          {!creating ? (
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <Plus /> New playlist
            </Button>
          ) : null}
        </div>
        {creating ? (
          <NewPlaylistForm
            busy={busy}
            canSaveQueue={currentQueueCount > 0}
            onCreate={handleCreate}
            onCancel={() => setCreating(false)}
          />
        ) : null}
        {playlists.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No playlists yet. Make one, then add songs to it from the queue or by pasting a link.
          </p>
        ) : (
          <ul className="divide-y border-y">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left hover:text-primary"
                  onClick={() => {
                    setSelectedId(playlist.id)
                    setRenaming(false)
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{playlist.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {playlist.createdByName} · {songCount(playlist.items.length)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section aria-labelledby="playlist-title" className="space-y-4">
      <div className="flex items-start gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setSelectedId(null)}
          aria-label="Back to all playlists"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  renameListeningPlaylist({ channelId, playlistId: selected.id, name: renameValue }),
                  "Playlist renamed"
                ).then(async (renamed) => {
                  if (!renamed) return
                  setRenaming(false)
                  await reload()
                })
              }}
            >
              <Input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                aria-label="Playlist name"
                maxLength={120}
                required
              />
              <Button type="submit" size="sm" disabled={busy || !renameValue.trim()}>
                Save
              </Button>
            </form>
          ) : (
            <>
              <h3 id="playlist-title" className="truncate text-lg font-semibold">
                {selected.name}
              </h3>
              <p className="text-xs text-muted-foreground">
                Made by {selected.createdByName} · {songCount(selected.items.length)}
              </p>
            </>
          )}
        </div>
        {selected.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Playlist options">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameValue(selected.name)
                  setRenaming(true)
                }}
              >
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={currentQueueCount === 0}
                onSelect={() => setReplaceConfirmationOpen(true)}
              >
                <RefreshCw /> Replace with the room&apos;s queue
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmationOpen(true)}>
                <Trash2 /> Delete playlist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || !canControl || selected.items.length === 0}
          onClick={() => void handlePlay(selected, selected.items[0] ?? null)}
        >
          <Play /> Play now
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || selected.items.length === 0}
          onClick={() => void handlePlay(selected, null)}
        >
          <ListPlus /> Add to the queue
        </Button>
      </div>

      {selected.canEdit ? (
        <AddSongForm
          busy={busy}
          submitLabel="Add"
          onSubmit={async (song) =>
            Boolean(
              await run(
                addSongToListeningPlaylist({
                  channelId,
                  playlistId: selected.id,
                  source: { kind: "link", url: song.url, title: song.title, artist: song.artist },
                }),
                `Added to ${selected.name}`
              ).then(async (added) => {
                if (added) await reload()
                return added
              })
            )
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Only {selected.createdByName} or a moderator can change this playlist.
        </p>
      )}

      {selected.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This playlist is empty. Paste a link above, or use a song&apos;s ⋯ menu in the Room tab to
          add it here.
        </p>
      ) : (
        <ol className="divide-y border-y">
          {selected.items.map((song, index) => (
            <li key={song.id} className="flex items-center gap-3 py-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{song.title}</p>
                {song.artist ? (
                  <p className="truncate text-xs text-muted-foreground">{song.artist}</p>
                ) : null}
              </div>
              {canControl ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handlePlay(selected, song)}
                  aria-label={`Play the playlist from ${song.title}`}
                >
                  <Play />
                </Button>
              ) : null}
              {selected.canEdit ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`More options for ${song.title}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={moveTargets.length === 0}>
                        <FolderInput /> Move to playlist
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-52">
                        {moveTargets.map((target) => (
                          <DropdownMenuItem
                            key={target.id}
                            onSelect={() =>
                              void run(
                                moveListeningPlaylistSong({
                                  channelId,
                                  playlistItemId: song.id,
                                  toPlaylistId: target.id,
                                }),
                                `Moved to ${target.name}`
                              ).then(() => reload())
                            }
                          >
                            {target.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        void run(
                          removeListeningPlaylistSong({ channelId, playlistItemId: song.id }),
                          "Removed from the playlist"
                        ).then(() => reload())
                      }
                    >
                      <Trash2 /> Remove from playlist
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <AlertDialog open={replaceConfirmationOpen} onOpenChange={setReplaceConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this playlist with the room&apos;s queue?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected.name} will have the queue&apos;s {songCount(currentQueueCount)} instead of
              its current songs. The previous version is kept so an administrator can recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it as is</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run(
                  replaceListeningPlaylistFromQueue({ channelId, playlistId: selected.id }),
                  "Playlist replaced with the queue"
                ).then(async (replaced) => {
                  if (!replaced) return
                  await reload()
                  setSelectedId(replaced.playlistId)
                })
              }
            >
              Replace playlist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteConfirmationOpen} onOpenChange={setDeleteConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It disappears from the team&apos;s playlists. An administrator can still recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playlist</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                void run(
                  deleteListeningPlaylist({ channelId, playlistId: selected.id }),
                  "Playlist deleted"
                ).then(async (deleted) => {
                  if (!deleted) return
                  setSelectedId(null)
                  await reload()
                })
              }
            >
              Delete playlist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** Chooser opened from a queued song's "Add to playlist…" menu item. */
export function AddToPlaylistDialog({
  channelId,
  song,
  onClose,
}: {
  readonly channelId: string
  readonly song: { readonly id: string; readonly title: string } | null
  readonly onClose: () => void
}): React.ReactElement {
  const { playlists, loading, reload } = usePlaylists(channelId)
  const [busy, setBusy] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const editable = playlists.filter((playlist) => playlist.canEdit)

  React.useEffect(() => {
    if (song) void reload()
  }, [song, reload])

  async function addTo(playlistId: string, playlistName: string): Promise<void> {
    if (!song) return
    setBusy(true)
    try {
      const result = await addSongToListeningPlaylist({
        channelId,
        playlistId,
        source: { kind: "queue", queueItemId: song.id },
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Added ${song.title} to ${playlistName}`)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function createAndAdd(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const created = await createEmptyListeningPlaylist({ channelId, name })
    setBusy(false)
    if (!created.success) {
      toast.error(created.error)
      return
    }
    setNewName("")
    await addTo(created.data.playlistId, name)
  }

  return (
    <Dialog open={song !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to a playlist</DialogTitle>
          <DialogDescription>{song?.title}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading playlists
          </p>
        ) : (
          <div className="space-y-3">
            {editable.length > 0 ? (
              <ul className="max-h-64 divide-y overflow-y-auto border-y">
                {editable.map((playlist) => (
                  <li key={playlist.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void addTo(playlist.id, playlist.name)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:text-primary disabled:opacity-50"
                    >
                      <span className="truncate font-medium">{playlist.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {songCount(playlist.items.length)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                You don&apos;t have a playlist yet. Name one below.
              </p>
            )}
            <form className="flex gap-2" onSubmit={(event) => void createAndAdd(event)}>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="New playlist name"
                aria-label="New playlist name"
                maxLength={120}
              />
              <Button type="submit" disabled={busy || !newName.trim()}>
                <Plus /> Create
              </Button>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

