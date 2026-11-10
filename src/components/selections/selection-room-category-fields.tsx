"use client"

/*
 * The Room and Category pickers in the selection forms (Add selection, Edit,
 * Save to Compass). Each is a drop-down list of the company's rooms or
 * categories (this job's first; see lib/domain/selections/room-category-options.ts)
 * where a name that is not listed can be typed and added with "Add “…”".
 * Each posts its value under `name`, like a plain input.
 */
import * as React from "react"

import { SearchableComboboxField } from "@/components/searchable-combobox"
import { UNCATEGORIZED } from "@/lib/domain/selections/room-category-options"

type PickerProps = {
  readonly id?: string
  readonly name: string
  readonly names: readonly string[]
  /** The starting value; when it changes (a template fills it in) the field follows. */
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly className?: string
}

function toOptions(names: readonly string[]): { readonly value: string; readonly label: string }[] {
  return names.map((name) => ({ value: name, label: name }))
}

/** Required. Lists the job's rooms, then the company's. */
export function SelectionRoomPicker({ id, name, names, value = "", onValueChange, className }: PickerProps): React.ReactElement {
  const options = React.useMemo(() => toOptions(names), [names])
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

const CATEGORY_HELP_TEXT =
  "The kind of item, e.g. Flooring or Lighting. Used to group the list and to set default lead times."

/** Optional (blank saves as "Uncategorized"), with a line explaining what a category is. */
export function SelectionCategoryPicker({ id, name, names, value = "", onValueChange, className }: PickerProps): React.ReactElement {
  const helpId = React.useId()
  const options = React.useMemo(() => toOptions(names), [names])
  return (
    <>
      <SearchableComboboxField
        id={id}
        name={name}
        defaultValue={value === UNCATEGORIZED ? "" : value}
        onValueChange={onValueChange}
        options={options}
        creatable
        clearLabel="No category"
        ariaLabel="Category"
        ariaDescribedBy={helpId}
        placeholder={UNCATEGORIZED}
        searchPlaceholder="Search or type a new category…"
        emptyMessage="No categories yet. Type one to add it."
        className={className}
      />
      <span id={helpId} className="block text-xs font-normal text-muted-foreground">
        {CATEGORY_HELP_TEXT}
      </span>
    </>
  )
}
