"use client"

/*
 * The Room picker in the selection forms (Add selection, Edit, Save to
 * Compass): a drop-down list of the company's rooms (this job's first; see
 * lib/domain/selections/room-options.ts) where a room that is not listed can
 * be typed and added with "Add “…”". Required. Posts its value under `name`,
 * like a plain input.
 */
import * as React from "react"

import { SearchableComboboxField } from "@/components/searchable-combobox"

export function SelectionRoomPicker({
  id,
  name,
  rooms,
  value = "",
  onValueChange,
  className,
}: {
  readonly id?: string
  readonly name: string
  readonly rooms: readonly string[]
  /** The starting value; when it changes (a template fills it in) the field follows. */
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly className?: string
}): React.ReactElement {
  const options = React.useMemo(() => rooms.map((room) => ({ value: room, label: room })), [rooms])
  return (
    <SearchableComboboxField
      id={id}
      name={name}
      defaultValue={value}
      onValueChange={onValueChange}
      options={options}
      creatable
      required
      ariaLabel="Room"
      placeholder="Choose or type a room"
      searchPlaceholder="Search or type a new room…"
      emptyMessage="No rooms yet. Type one to add it."
      className={className}
    />
  )
}
