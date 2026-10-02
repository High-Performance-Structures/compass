"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  linkDirectoryPersonAccount,
  listDirectoryAccountOptions,
  type DirectoryAccountOption,
  type DirectoryPersonKind,
} from "@/app/actions/contact-account-links"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type DirectoryAccountLinkTarget = {
  readonly kind: DirectoryPersonKind
  readonly personId: string
  readonly name: string
  readonly userId: string | null
}

const NO_ACCOUNT = "__no_account__"

export function DirectoryAccountLinkDialog({
  target,
  onOpenChange,
  onLinked,
}: {
  readonly target: DirectoryAccountLinkTarget | null
  readonly onOpenChange: (open: boolean) => void
  readonly onLinked: () => void
}): React.ReactElement {
  const [accounts, setAccounts] = React.useState<readonly DirectoryAccountOption[]>([])
  const [selectedId, setSelectedId] = React.useState(NO_ACCOUNT)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!target) return
    setSelectedId(target.userId ?? NO_ACCOUNT)
    let cancelled = false
    void listDirectoryAccountOptions(target.kind).then((next) => {
      if (!cancelled) setAccounts(next)
    }).catch(() => {
      if (!cancelled) toast.error("Could not load matching Compass accounts")
    })
    return () => { cancelled = true }
  }, [target])

  const save = async () => {
    if (!target) return
    setBusy(true)
    try {
      const result = await linkDirectoryPersonAccount(
        target.kind, target.personId, selectedId === NO_ACCOUNT ? null : selectedId
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contact account link updated")
      onLinked()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const options = [
    { value: NO_ACCOUNT, label: "No Compass account" },
    ...accounts.map((account) => ({
      value: account.id,
      label: account.name,
      description: account.email,
      keywords: account.role,
    })),
  ]
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link Compass account</DialogTitle>
          <DialogDescription>
            Select the exact login for {target?.name}. This link grants that person the ability to propose changes to their own Sage contact record. Do not choose by email alone.
          </DialogDescription>
        </DialogHeader>
        <SearchableCombobox
          options={options}
          value={selectedId}
          onValueChange={setSelectedId}
          ariaLabel="Compass account"
          placeholder="Choose an account"
          searchPlaceholder="Search accounts…"
          groupHeading="Matching role in this organization"
          disabled={busy}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>Save link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
