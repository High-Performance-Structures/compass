"use client"

import * as React from "react"
import {
  ListMusic,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import {
  addListeningPlaylistToRoom,
  createListeningPlaylist,
  deleteListeningPlaylist,
  getListeningPlaylists,
  renameListeningPlaylist,
  replaceListeningPlaylistFromQueue,
  type ListeningPlaylistData,
} from "@/app/actions/listening-playlists"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ListeningRoomPlaylists({
  channelId,
  currentQueueCount,
  onQueueChanged,
}: {
  readonly channelId: string
  readonly currentQueueCount: number
  readonly onQueueChanged: () => void
}): React.ReactElement {
  const [playlists, setPlaylists] = React.useState<readonly ListeningPlaylistData[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [newName, setNewName] = React.useState("")
  const [editName, setEditName] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [replaceConfirmationOpen, setReplaceConfirmationOpen] =
    React.useState(false)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] =
    React.useState(false)

  const loadPlaylists = React.useCallback(async (): Promise<void> => {
    const result = await getListeningPlaylists(channelId)
    if (!result.success) {
      toast.error(result.error)
      setLoading(false)
      return
    }
    setPlaylists(result.data.playlists)
    setSelectedId((current) => {
      if (current && result.data.playlists.some((playlist) => playlist.id === current)) {
        return current
      }
      return result.data.playlists[0]?.id ?? null
    })
    setLoading(false)
  }, [channelId])

  React.useEffect(() => {
    void loadPlaylists()
  }, [loadPlaylists])

  const selected = playlists.find((playlist) => playlist.id === selectedId) ?? null

  async function handleCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await createListeningPlaylist({ channelId, name: newName })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSelectedId(result.data.playlistId)
      setNewName("")
      setCreating(false)
      await loadPlaylists()
      toast.success("Playlist saved")
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    try {
      const result = await renameListeningPlaylist({
        channelId,
        playlistId: selected.id,
        name: editName,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setEditing(false)
      await loadPlaylists()
      toast.success("Playlist renamed")
    } finally {
      setBusy(false)
    }
  }

  async function handleAddToRoom(): Promise<void> {
    if (!selected) return
    setBusy(true)
    try {
      const result = await addListeningPlaylistToRoom({
        channelId,
        playlistId: selected.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      onQueueChanged()
      toast.success(
        `${result.data.addedCount} track${result.data.addedCount === 1 ? "" : "s"} added to the room`
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleReplace(): Promise<void> {
    if (!selected) return
    setBusy(true)
    try {
      const result = await replaceListeningPlaylistFromQueue({
        channelId,
        playlistId: selected.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSelectedId(result.data.playlistId)
      await loadPlaylists()
      toast.success("Playlist updated from the shared queue")
    } finally {
      setBusy(false)
      setReplaceConfirmationOpen(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selected) return
    setBusy(true)
    try {
      const result = await deleteListeningPlaylist({
        channelId,
        playlistId: selected.id,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setSelectedId(null)
      await loadPlaylists()
      toast.success("Playlist deleted")
    } finally {
      setBusy(false)
      setDeleteConfirmationOpen(false)
    }
  }

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby="playlists-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="playlists-title" className="flex items-center gap-2 text-sm font-semibold">
            <ListMusic className="size-4" /> Saved playlists
          </h3>
          <p className="text-xs text-muted-foreground">
            Shared with your team. Adding one keeps the current room queue intact.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || currentQueueCount === 0}
          onClick={() => {
            setCreating((current) => !current)
            setEditing(false)
          }}
        >
          <Save /> Save queue
        </Button>
      </div>

      {creating ? (
        <form className="flex gap-2" onSubmit={(event) => void handleCreate(event)}>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Playlist name"
            aria-label="New playlist name"
            maxLength={120}
            required
          />
          <Button type="submit" size="sm" disabled={busy || !newName.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </form>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading playlists
        </p>
      ) : playlists.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved playlists yet. Build a queue, then save it for another day.
        </p>
      ) : (
        <>
          <Select
            value={selectedId ?? undefined}
            onValueChange={(value) => {
              setSelectedId(value)
              setEditing(false)
            }}
          >
            <SelectTrigger aria-label="Saved playlist">
              <SelectValue placeholder="Choose a playlist" />
            </SelectTrigger>
            <SelectContent>
              {playlists.map((playlist) => (
                <SelectItem key={playlist.id} value={playlist.id}>
                  {playlist.name} · {playlist.items.length} track
                  {playlist.items.length === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  Saved by {selected.createdByName} · {selected.items.length} track
                  {selected.items.length === 1 ? "" : "s"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddToRoom()}
                  disabled={busy || selected.items.length === 0}
                >
                  {busy ? <Loader2 className="animate-spin" /> : <Plus />}
                  Add to room
                </Button>
              </div>

              <ol className="max-h-36 divide-y overflow-y-auto border-y">
                {selected.items.map((item) => (
                  <li key={item.id} className="py-2 text-sm">
                    <span className="font-medium">{item.title}</span>
                    {item.artist ? (
                      <span className="text-muted-foreground"> · {item.artist}</span>
                    ) : null}
                  </li>
                ))}
              </ol>

              {selected.canEdit ? (
                <div className="space-y-2">
                  {editing ? (
                    <form className="flex gap-2" onSubmit={(event) => void handleRename(event)}>
                      <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        aria-label="Playlist name"
                        maxLength={120}
                        required
                      />
                      <Button type="submit" size="sm" disabled={busy || !editName.trim()}>
                        Save name
                      </Button>
                    </form>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditName(selected.name)
                        setEditing((current) => !current)
                        setCreating(false)
                      }}
                    >
                      <Pencil /> Rename
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={currentQueueCount === 0}
                      onClick={() => setReplaceConfirmationOpen(true)}
                    >
                      <RefreshCw /> Update from queue
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteConfirmationOpen(true)}
                    >
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <AlertDialog
        open={replaceConfirmationOpen}
        onOpenChange={setReplaceConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update this playlist from the current queue?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces every saved track in {selected?.name ?? "the playlist"} with
              the room&apos;s current {currentQueueCount} track
              {currentQueueCount === 1 ? "" : "s"}. The previous version remains in the
              deletion audit for recovery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep saved version</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleReplace()}>
              Update playlist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteConfirmationOpen}
        onOpenChange={setDeleteConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this playlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.name ?? "This playlist"} will disappear from the team library.
              Its deletion record is retained so an administrator can recover it if
              needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playlist</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              Delete playlist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
