"use client"

import * as React from "react"
import { toast } from "sonner"

import type { ActionResult } from "@/lib/action-result"
import type { ListSheetPreferences, PersonalListSheetPreference } from "@/lib/domain/settings/list-sheet-rules"

type SavePersonalColumns = (input: {
  readonly sheetId: string
  readonly hiddenColumnIds: string[]
  readonly shownColumnIds: string[]
}) => Promise<ActionResult<null>>

type ListSheetContextValue = {
  readonly preferences: ListSheetPreferences
  /** Applies a person's columns at once and saves them; null resets to the company layout. */
  readonly setPersonal: (sheetId: string, preference: PersonalListSheetPreference | null) => void
}

const ListSheetContext = React.createContext<ListSheetContextValue | null>(null)

/**
 * Every sheet's company layout and the person's own columns, loaded once by
 * the dashboard layout. Column changes show at once and save in the
 * background.
 */
export function ListSheetProvider({
  preferences,
  savePersonal,
  children,
}: {
  readonly preferences: ListSheetPreferences
  /** The server action that saves a person's columns, passed in by the layout. */
  readonly savePersonal: SavePersonalColumns
  readonly children: React.ReactNode
}): React.ReactElement {
  // Columns this person changed in this session. They are merged over every
  // server refresh, so an unrelated refresh never snaps a change back.
  const [local, setLocal] = React.useState<Readonly<Record<string, PersonalListSheetPreference | null>>>({})
  const personal = React.useMemo(() => {
    const merged: Record<string, PersonalListSheetPreference> = { ...preferences.personal }
    for (const [sheetId, preference] of Object.entries(local)) {
      if (preference === null) delete merged[sheetId]
      else merged[sheetId] = preference
    }
    return merged
  }, [preferences.personal, local])

  const canSave = preferences.canSavePersonal
  const setPersonal = React.useCallback((sheetId: string, preference: PersonalListSheetPreference | null) => {
    setLocal((current) => ({ ...current, [sheetId]: preference }))
    if (!canSave) return
    void savePersonal({
      sheetId,
      hiddenColumnIds: [...(preference?.hiddenColumnIds ?? [])],
      shownColumnIds: [...(preference?.shownColumnIds ?? [])],
    }).then((result) => {
      if (!result.success) toast.error("Your columns changed here but could not be saved.")
    }).catch(() => toast.error("Your columns changed here but could not be saved."))
  }, [canSave, savePersonal])

  const value = React.useMemo<ListSheetContextValue>(
    () => ({ preferences: { ...preferences, personal }, setPersonal }),
    [preferences, personal, setPersonal],
  )
  return <ListSheetContext.Provider value={value}>{children}</ListSheetContext.Provider>
}

export function useListSheetContext(): ListSheetContextValue | null {
  return React.useContext(ListSheetContext)
}
