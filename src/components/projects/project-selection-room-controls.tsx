"use client"

/*
 * Room and row edits on the Selections page's Finish specs: the "…" menu on
 * each room (Rename, Duplicate, Delete), "Add room" beside Import, and the
 * "…" menu on each selection (Duplicate, Move to room). The rules live in
 * src/lib/domain/selections/room-edits.ts.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCopy, IconDots, IconPencil, IconPlus, IconTrash, IconArrowsMoveVertical } from "@tabler/icons-react"

import {
  addProjectSelectionRoom,
  deleteProjectSelectionRoom,
  duplicateProjectSelection,
  duplicateProjectSelectionRoom,
  moveProjectSelectionToRoom,
  renameProjectSelectionRoom,
} from "@/app/actions/project-selection-rooms"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { selectionLock } from "@/lib/domain/selections/locks"
import type { ProjectSelectionItem, ProjectSelectionOption } from "@/lib/domain/selections/types"

type Result = { readonly success: true } | { readonly success: false; readonly error: string }

/** Runs a room action, refreshes the page when it lands, and keeps its error for the dialog. */
function useRoomAction(): {
  readonly busy: boolean
  readonly error: string | null
  readonly clear: () => void
  readonly run: (action: () => Promise<Result>) => Promise<boolean>
} {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = React.useCallback(async (action: () => Promise<Result>) => {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.success) {
      setError(result.error)
      return false
    }
    router.refresh()
    return true
  }, [router])
  return { busy, error, clear: () => setError(null), run }
}

function RoomFields({
  name,
  type,
  roomTypes,
  onName,
  onType,
}: {
  readonly name: string
  readonly type: string
  readonly roomTypes: readonly ProjectSelectionOption[]
  readonly onName: (value: string) => void
  readonly onType: (value: string) => void
}): React.ReactElement {
  const listId = React.useId()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Room</span>
        <Input autoFocus value={name} maxLength={120} onChange={(event) => onName(event.target.value)} />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Room type</span>
        <Input value={type} maxLength={120} list={listId} placeholder="Optional" onChange={(event) => onType(event.target.value)} />
        <datalist id={listId}>
          {roomTypes.map((option) => (
            <option key={option.value} value={option.label} />
          ))}
        </datalist>
      </label>
    </div>
  )
}

type RoomNameDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly description: string
  readonly submitLabel: string
  readonly initialName: string
  readonly initialType: string
  readonly roomTypes: readonly ProjectSelectionOption[]
  readonly onSubmit: (name: string, type: string) => Promise<Result>
}

/** A name + type dialog for Add room, Rename room and Duplicate room. */
function RoomNameDialog(props: RoomNameDialogProps): React.ReactElement {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* The form mounts each time the dialog opens, so it starts from the room's current values. */}
        <RoomNameForm {...props} />
      </DialogContent>
    </Dialog>
  )
}

function RoomNameForm({
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName,
  initialType,
  roomTypes,
  onSubmit,
}: RoomNameDialogProps): React.ReactElement {
  const [name, setName] = React.useState(initialName)
  const [type, setType] = React.useState(initialType)
  const action = useRoomAction()

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (await action.run(() => onSubmit(name, type))) onOpenChange(false)
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <RoomFields name={name} type={type} roomTypes={roomTypes} onName={setName} onType={setType} />
      {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" disabled={action.busy || !name.trim()}>{action.busy ? "Saving…" : submitLabel}</Button>
      </DialogFooter>
    </form>
  )
}

/** "Add room" beside Import: an empty room at the end of the schedule. */
export function AddSelectionRoomButton({
  projectId,
  roomTypes,
}: {
  readonly projectId: string
  readonly roomTypes: readonly ProjectSelectionOption[]
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <IconPlus className="size-4" />
        Add room
      </Button>
      <RoomNameDialog
        open={open}
        onOpenChange={setOpen}
        title="Add a room"
        description="The new room goes at the end of the schedule. Drag it to move it."
        submitLabel="Add room"
        initialName=""
        initialType=""
        roomTypes={roomTypes}
        onSubmit={(roomName, roomType) => addProjectSelectionRoom(projectId, { roomName, roomType })}
      />
    </>
  )
}

/** The "…" menu on a room's header. */
export function SelectionRoomMenu({
  projectId,
  room,
  roomTypes,
}: {
  readonly projectId: string
  readonly room: {
    readonly roomName: string
    readonly roomType: string | null
    readonly selections: readonly ProjectSelectionItem[]
    readonly sourceWorkbookId: string | null
  }
  readonly roomTypes: readonly ProjectSelectionOption[]
}): React.ReactElement {
  const [dialog, setDialog] = React.useState<"rename" | "duplicate" | "delete" | null>(null)
  const remove = useRoomAction()
  const count = room.selections.length
  // Approved, ordered, installed and replaced selections stay on record (the server checks again).
  const kept = room.selections.filter((selection) => selection.ownerApproved || selection.status === "approved" || selectionLock(selection.status, false) !== null).length

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" aria-label={`More for ${room.roomName}`}>
            <IconDots className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("rename")}>
            <IconPencil className="size-4" />
            Rename or change type
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("duplicate")}>
            <IconCopy className="size-4" />
            Duplicate room
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => { remove.clear(); setDialog("delete") }}>
            <IconTrash className="size-4" />
            Delete room
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RoomNameDialog
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        title={`Rename ${room.roomName}`}
        description={
          room.sourceWorkbookId
            ? "Every selection in the room moves with it, and clients see the new name. A re-import of the workbook keeps this name."
            : "Every selection in the room moves with it, and clients see the new name."
        }
        submitLabel="Save"
        initialName={room.roomName}
        initialType={room.roomType ?? ""}
        roomTypes={roomTypes}
        onSubmit={(roomName, roomType) => renameProjectSelectionRoom(projectId, { fromName: room.roomName, roomName, roomType })}
      />

      <RoomNameDialog
        open={dialog === "duplicate"}
        onOpenChange={(open) => setDialog(open ? "duplicate" : null)}
        title={`Duplicate ${room.roomName}`}
        description="Copies every selection, with its choices, supplier links and photos, as new selections waiting for a decision. Nothing is picked or approved in the copy."
        submitLabel="Duplicate"
        initialName={`${room.roomName} (copy)`}
        initialType={room.roomType ?? ""}
        roomTypes={roomTypes}
        onSubmit={(roomName, roomType) => duplicateProjectSelectionRoom(projectId, { fromName: room.roomName, roomName, roomType })}
      />

      <AlertDialog open={dialog === "delete"} onOpenChange={(open) => setDialog(open ? "delete" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {room.roomName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {kept > 0
                ? `${kept} of its selections ${kept === 1 ? "is" : "are"} approved, ordered or installed and must stay on record. Move ${kept === 1 ? "it" : "them"} to another room first.`
                : count > 0
                  ? `This removes the room and its ${count} ${count === 1 ? "selection" : "selections"}, with their choices, links and photos. Clients won't see them anymore. This cannot be undone.`
                  : "This removes the empty room. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error && <p role="alert" className="text-sm text-destructive">{remove.error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.busy || kept > 0}
              onClick={() => void remove.run(() => deleteProjectSelectionRoom(projectId, room.roomName)).then((done) => { if (done) setDialog(null) })}
            >
              {remove.busy ? "Deleting…" : "Delete room"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** The "…" menu on one selection: Duplicate, Move to room. */
export function SelectionRowMenu({
  projectId,
  selection,
  roomNames,
}: {
  readonly projectId: string
  readonly selection: ProjectSelectionItem
  /** The job's rooms, in order. */
  readonly roomNames: readonly string[]
}): React.ReactElement {
  const [moving, setMoving] = React.useState(false)
  const [target, setTarget] = React.useState("")
  const action = useRoomAction()
  const listId = React.useId()
  const others = roomNames.filter((name) => name !== selection.roomName)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" aria-label={`More for ${selection.name}`}>
            <IconDots className="size-4" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={action.busy} onSelect={() => void action.run(() => duplicateProjectSelection(projectId, selection.id))}>
            <IconCopy className="size-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { action.clear(); setTarget(""); setMoving(true) }}>
            <IconArrowsMoveVertical className="size-4" />
            Move to room…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {action.error && !moving && <p role="alert" className="text-xs text-destructive">{action.error}</p>}

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void action.run(() => moveProjectSelectionToRoom(projectId, { selectionId: selection.id, roomName: target })).then((done) => { if (done) setMoving(false) })
            }}
          >
            <DialogHeader>
              <DialogTitle>Move “{selection.name}”</DialogTitle>
              <DialogDescription>
                Its follow-up selections move with it. The pick and any approval stay as they are.
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">To room</span>
              <Input autoFocus value={target} list={listId} maxLength={120} placeholder="Choose a room or type a new one" onChange={(event) => setTarget(event.target.value)} />
              <datalist id={listId}>
                {others.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMoving(false)}>Cancel</Button>
              <Button type="submit" disabled={action.busy || !target.trim()}>{action.busy ? "Moving…" : "Move"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
