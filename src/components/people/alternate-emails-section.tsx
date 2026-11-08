"use client"

import * as React from "react"
import { IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  addUserAlternateEmail,
  getUserAlternateEmails,
  removeUserAlternateEmail,
} from "@/app/actions/user-alternate-emails"
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
import { Label } from "@/components/ui/label"
import type { AlternateEmail } from "@/lib/domain/identity/alternate-emails"

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly emails: readonly AlternateEmail[]; readonly canEdit: boolean }

/**
 * A staff member's other email addresses (an old company domain, a mailbox
 * they write from). Never used to sign in: Compass uses them to recognize the
 * person on imported messages and offers them as extra send-to addresses.
 */
export function AlternateEmailsSection({ userId, signInEmail }: { readonly userId: string; readonly signInEmail: string }): React.ReactElement {
  const [loaded, setLoaded] = React.useState<Loaded>({ kind: "loading" })
  const [draft, setDraft] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [removing, setRemoving] = React.useState<AlternateEmail | null>(null)

  const load = React.useCallback(async () => {
    const result = await getUserAlternateEmails(userId)
    setLoaded(result.success ? { kind: "ready", emails: result.data.emails, canEdit: result.data.canEdit } : { kind: "error", message: result.error })
  }, [userId])

  React.useEffect(() => {
    setLoaded({ kind: "loading" })
    setDraft("")
    setError(null)
    void load()
  }, [load])

  async function add(): Promise<void> {
    setSaving(true)
    setError(null)
    const result = await addUserAlternateEmail(userId, draft)
    setSaving(false)
    if (!result.success) {
      setError(result.error)
      return
    }
    setDraft("")
    toast.success("Email address added")
    await load()
  }

  async function remove(): Promise<void> {
    if (!removing) return
    const result = await removeUserAlternateEmail(userId, removing.id)
    setRemoving(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Email address removed")
    await load()
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="alternate-email">Other email addresses</Label>
      <p className="text-xs text-muted-foreground">
        Addresses this person also writes from, such as an old company domain. They are not used to sign in. Compass uses them to recognize the person on imported messages and offers them as extra send-to addresses; {signInEmail} stays the default.
      </p>
      {loaded.kind === "loading" ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded.kind === "error" ? <p role="alert" className="text-sm text-destructive">{loaded.message}</p> : null}
      {loaded.kind === "ready" ? (
        <>
          {loaded.emails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other addresses.</p>
          ) : (
            <ul className="divide-y border-y">
              {loaded.emails.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="min-w-0 break-all">{item.email}</span>
                  {loaded.canEdit ? (
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item.email}`} onClick={() => setRemoving(item)}>
                      <IconTrash className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {loaded.canEdit ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void add()
              }}
            >
              <Input
                id="alternate-email"
                type="email"
                value={draft}
                placeholder="name@old-domain.com"
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={saving || draft.trim() === ""}>{saving ? "Adding…" : "Add"}</Button>
            </form>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </>
      ) : null}

      <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this email address?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.email} will no longer be offered as a send-to address or used to recognize this person on imported messages. People already linked stay linked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
