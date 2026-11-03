"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { getProjectContactDirectoryOptions, removeProjectContact, saveProjectContact } from "@/app/actions/project-contacts"
import type {
  ProjectContactCostCodeOption,
  ProjectContactDirectoryOption,
  ProjectContactItem,
  ProjectContactMutationInput,
  ProjectContactSageOptions,
} from "@/lib/domain/contacts/types"

import {
  initialInput,
  inputWithCostCode,
  inputWithCustomerContact,
  inputWithDirectoryOption,
  inputWithDivision,
  inputWithVendorContact,
  isPresetProjectRole,
} from "./contact-editor-rules"
import { useContactDirectoryAdds } from "./use-contact-directory-adds"
import { useNewContactDrafts } from "./use-new-contact-drafts"

/** The project contact editor's draft, directory links and save/remove. */
export function useProjectContactEditor({
  projectId,
  contact,
  directoryOptions,
  sageOptions,
}: {
  readonly projectId: string
  readonly contact: ProjectContactItem | null
  readonly directoryOptions: readonly ProjectContactDirectoryOption[]
  readonly sageOptions: ProjectContactSageOptions
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [directoryOpenKey, setDirectoryOpenKey] = useState<string | null>(null)
  const [availableDirectoryOptions, setAvailableDirectoryOptions] = useState(
    directoryOptions
  )
  const [input, setInput] = useState(() => initialInput(projectId, contact))
  const drafts = useNewContactDrafts()
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [customRoleSelected, setCustomRoleSelected] = useState(
    () => Boolean(contact?.role && !isPresetProjectRole(contact.role))
  )
  const [isPending, startTransition] = useTransition()
  const isEditing = contact !== null
  const selectedDirectory = availableDirectoryOptions.find(
    (option) =>
      option.id === input.directorySourceId &&
      option.sourceType === input.directorySourceType
  ) ?? null
  const vendorOptions = availableDirectoryOptions.filter(
    (option) => option.sourceType === "vendor"
  )
  const customerOptions = availableDirectoryOptions.filter(
    (option) => option.sourceType === "customer"
  )
  const selectedVendor =
    selectedDirectory?.sourceType === "vendor" ? selectedDirectory : null
  const selectedCustomer =
    selectedDirectory?.sourceType === "customer" ? selectedDirectory : null
  const selectedCustomerContact = selectedCustomer?.customerContacts.find(
    (person) => person.id === input.customerContactId
  ) ?? null
  const selectedVendorContact = selectedVendor?.vendorContacts.find(
    (vendorContact) => vendorContact.id === input.vendorContactId
  ) ?? null
  const legacyVendorPerson =
    selectedVendor &&
    !input.vendorContactId &&
    input.displayName.trim() &&
    input.displayName.trim() !== selectedVendor.displayName
      ? input.displayName.trim()
      : null
  const filteredCostCodes = input.csiDivision
    ? sageOptions.costCodes.filter(
        (option) => option.divisionCode === input.csiDivision
      )
    : sageOptions.costCodes
  const identityManagedByActiveUser =
    input.directorySourceType === null
      ? (contact?.identityManagedByActiveUser ?? false)
      : (selectedCustomerContact?.identityManagedByActiveUser ??
        selectedVendorContact?.identityManagedByActiveUser ??
        selectedDirectory?.identityManagedByActiveUser ??
        contact?.identityManagedByActiveUser ??
        false)
  const identityReadOnly = selectedDirectory !== null || identityManagedByActiveUser

  function updateInput<Key extends keyof ProjectContactMutationInput>(
    key: Key,
    value: ProjectContactMutationInput[Key]
  ): void {
    setInput((current) => ({ ...current, [key]: value }))
  }

  function resetEditor(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) {
      setInput(initialInput(projectId, contact))
      setAvailableDirectoryOptions(directoryOptions)
      setDirectoryOpenKey(null)
      drafts.resetDrafts()
      setCustomRoleSelected(
        Boolean(contact?.role && !isPresetProjectRole(contact.role))
      )
      void refreshDirectory()
    }
  }

  async function refreshDirectory(): Promise<void> {
    setDirectoryLoading(true)
    try {
      setAvailableDirectoryOptions(await getProjectContactDirectoryOptions(projectId))
    } catch {
      toast.error("Could not refresh the contact directory. The saved list is still available.")
    } finally {
      setDirectoryLoading(false)
    }
  }

  function applyDirectoryOption(option: ProjectContactDirectoryOption): void {
    if (option.alreadyOnProject) return
    setDirectoryOpenKey(`${option.sourceType}:${option.id}`)
    setCustomRoleSelected(false)
    setInput((current) => inputWithDirectoryOption(current, option))
  }

  function applyVendorContact(contactId: string): void {
    if (!selectedVendor) return
    setInput((current) => inputWithVendorContact(current, selectedVendor, contactId) ?? current)
  }

  function applyCustomerContact(contactId: string): void {
    if (!selectedCustomer) return
    setInput((current) => inputWithCustomerContact(current, selectedCustomer, contactId) ?? current)
  }

  function applyDivision(divisionCode: string): void {
    setInput((current) => inputWithDivision(current, divisionCode, sageOptions) ?? current)
  }

  function applyCostCode(
    option: ProjectContactCostCodeOption | null
  ): void {
    setInput((current) => inputWithCostCode(current, option))
  }

  const adds = useContactDirectoryAdds({
    input,
    setInput,
    drafts,
    customerOptions,
    selectedCustomer,
    selectedVendor,
    startTransition,
    setAvailableDirectoryOptions,
    applyDirectoryOption,
    applyCustomerContact,
  })

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveProjectContact(input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(isEditing ? "Project contact updated." : "Project contact added.")
      if (result.warning) toast.warning(result.warning)
      setOpen(false)
      router.refresh()
    })
  }

  function remove(): void {
    if (!contact) return
    startTransition(async () => {
      const result = await removeProjectContact(projectId, contact.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contact removed from this project.")
      setOpen(false)
      router.refresh()
    })
  }

  return {
    open,
    setOpen,
    directoryOpenKey,
    availableDirectoryOptions,
    input,
    setInput,
    updateInput,
    drafts,
    directoryLoading,
    customRoleSelected,
    setCustomRoleSelected,
    isPending,
    isEditing,
    selectedDirectory,
    vendorOptions,
    customerOptions,
    selectedVendor,
    selectedCustomer,
    legacyVendorPerson,
    filteredCostCodes,
    identityManagedByActiveUser,
    identityReadOnly,
    resetEditor,
    refreshDirectory,
    applyDirectoryOption,
    applyVendorContact,
    applyCustomerContact,
    applyDivision,
    applyCostCode,
    ...adds,
    submit,
    remove,
  }
}

export type ProjectContactEditorState = ReturnType<typeof useProjectContactEditor>
