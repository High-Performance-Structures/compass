"use client"

import type * as React from "react"

import {
  SearchableCombobox,
  type SearchableComboboxOption,
} from "@/components/searchable-combobox"

export type ProjectComboboxOption = {
  readonly id: string
  readonly name: string
  readonly projectNumber?: string | null
  readonly clientName?: string | null
}

export type ProjectComboboxSpecialOption = {
  readonly value: string
  readonly label: string
  readonly description?: string
  readonly keywords?: string
}

type ProjectComboboxProps = {
  readonly projects: readonly ProjectComboboxOption[]
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly id?: string
  readonly ariaLabel?: string
  readonly placeholder?: string
  readonly searchPlaceholder?: string
  readonly emptyMessage?: string
  readonly specialOptions?: readonly ProjectComboboxSpecialOption[]
  readonly disabled?: boolean
  readonly className?: string
  readonly popoverClassName?: string
}

function projectDescription(project: ProjectComboboxOption): string | null {
  if (project.projectNumber && project.clientName) {
    return `${project.name} - ${project.clientName}`
  }
  if (project.projectNumber) return project.name
  return project.clientName ?? null
}

export function ProjectCombobox({
  projects,
  value,
  onValueChange,
  id,
  ariaLabel = "Choose project",
  placeholder = "Select a project",
  searchPlaceholder = "Search number, name, or client...",
  emptyMessage = "No matching projects.",
  specialOptions = [],
  disabled = false,
  className,
  popoverClassName,
}: ProjectComboboxProps): React.ReactElement {
  const specialChoices: readonly SearchableComboboxOption[] = specialOptions.map(
    (option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
      keywords: option.keywords,
    })
  )
  const projectChoices: readonly SearchableComboboxOption[] = projects.map(
    (project) => ({
      value: project.id,
      label: project.projectNumber ?? project.name,
      selectedLabel: project.projectNumber
        ? `${project.projectNumber} - ${project.name}`
        : project.name,
      description: projectDescription(project) ?? undefined,
      keywords: project.clientName ?? undefined,
    })
  )

  return (
    <SearchableCombobox
      id={id}
      ariaLabel={ariaLabel}
      options={[...specialChoices, ...projectChoices]}
      value={value}
      onValueChange={onValueChange}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      groupHeading="Projects"
      disabled={disabled}
      className={className}
      popoverClassName={popoverClassName}
    />
  )
}
