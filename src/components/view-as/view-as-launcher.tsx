"use client"

/*
 * View as entry points (src/lib/view-as/). All show only when the person may
 * use View as and developer mode is on (useDeveloperMode().canViewAs):
 * - ViewAsPersonDialog: the person search in the developer menu;
 * - ViewAsMenuItem: a row action in the People sheet;
 * - ViewAsButton: a row action in Contacts.
 * Starting reloads into the viewed person's dashboard; the server rechecks
 * every permission.
 */
import * as React from "react"
import { IconEye } from "@tabler/icons-react"
import { toast } from "sonner"

import { searchViewAsPeopleAction, startViewAs } from "@/app/actions/view-as"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { ViewAsPersonOption } from "@/lib/domain/identity/view-as-people"
import { userRoleLabel } from "@/lib/user-roles"

function useStartViewAs(): { readonly starting: boolean; readonly start: (userId: string) => Promise<void> } {
  const [starting, setStarting] = React.useState(false)
  const start = React.useCallback(async (userId: string): Promise<void> => {
    setStarting(true)
    const result = await startViewAs(userId)
    if (!result.success) {
      setStarting(false)
      toast.error(result.error)
      return
    }
    // A full load so every screen is rendered fresh as the viewed person.
    window.location.assign("/dashboard")
  }, [])
  return { starting, start }
}

/** "View as…" in a People row's menu. */
export function ViewAsMenuItem({ userId }: { readonly userId: string }): React.ReactElement | null {
  const { canViewAs } = useDeveloperMode()
  const { starting, start } = useStartViewAs()
  if (!canViewAs) return null
  return (
    <DropdownMenuItem disabled={starting} onClick={() => void start(userId)}>
      <IconEye className="size-4" />
      View as…
    </DropdownMenuItem>
  )
}

/** "View as" button for a Contacts row that has a Compass account. */
export function ViewAsButton({ userId }: { readonly userId: string | null }): React.ReactElement | null {
  const { canViewAs } = useDeveloperMode()
  const { starting, start } = useStartViewAs()
  if (!canViewAs || !userId) return null
  return (
    <Button type="button" size="sm" variant="ghost" disabled={starting} onClick={() => void start(userId)}>
      <IconEye className="size-4" />
      View as
    </Button>
  )
}

/** Developer menu: find anyone in the company and view Compass as them. */
export function ViewAsPersonDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const [query, setQuery] = React.useState("")
  const [people, setPeople] = React.useState<readonly ViewAsPersonOption[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [searching, setSearching] = React.useState(false)
  const { starting, start } = useStartViewAs()

  React.useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setPeople([])
      setError(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      void searchViewAsPeopleAction(trimmed).then((result) => {
        if (cancelled) return
        setSearching(false)
        if (result.success) {
          setPeople(result.data)
          setError(null)
        } else {
          setPeople([])
          setError(result.error)
        }
      })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>View as…</DialogTitle>
          <DialogDescription>
            Open a live, read-only copy of someone&apos;s Compass to see exactly what they see. Nothing can be saved or sent,
            they are not notified, and the view is recorded in Activity.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={query}
          placeholder="Search staff, owners and vendors by name or email"
          aria-label="Search people to view as"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-80 overflow-y-auto">
          {error ? <p className="py-2 text-sm text-muted-foreground">{error}</p> : null}
          {!error && searching ? <p className="py-2 text-sm text-muted-foreground">Searching…</p> : null}
          {!error && !searching && query.trim().length >= 2 && people.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No one found.</p>
          ) : null}
          <ul className="divide-y">
            {people.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{person.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {person.email} · {userRoleLabel(person.role)}
                  </p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={starting} onClick={() => void start(person.id)}>
                  View as
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
