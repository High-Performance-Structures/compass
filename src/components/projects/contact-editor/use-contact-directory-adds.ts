"use client"

import type { Dispatch, SetStateAction, TransitionStartFunction } from "react"
import { toast } from "sonner"

import { createCustomerDirectoryContact } from "@/app/actions/customers"
import { saveCustomerDirectoryPerson } from "@/app/actions/customer-people"
import { createVendor, createVendorContact } from "@/app/actions/vendors"
import type {
  ProjectContactDirectoryOption,
  ProjectContactMutationInput,
} from "@/lib/domain/contacts/types"
import { findExistingNamedPerson } from "@/lib/customer-person-match"

import { matchingCustomerOptions } from "./contact-editor-rules"
import type { NewContactDrafts } from "./use-new-contact-drafts"

/**
 * Adding a new client company, client person, vendor company or vendor
 * person from inside the project contact editor, then selecting it.
 */
export function useContactDirectoryAdds({
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
}: {
  readonly input: ProjectContactMutationInput
  readonly setInput: Dispatch<SetStateAction<ProjectContactMutationInput>>
  readonly drafts: NewContactDrafts
  readonly customerOptions: readonly ProjectContactDirectoryOption[]
  readonly selectedCustomer: ProjectContactDirectoryOption | null
  readonly selectedVendor: ProjectContactDirectoryOption | null
  readonly startTransition: TransitionStartFunction
  readonly setAvailableDirectoryOptions: Dispatch<SetStateAction<readonly ProjectContactDirectoryOption[]>>
  readonly applyDirectoryOption: (option: ProjectContactDirectoryOption) => void
  readonly applyCustomerContact: (contactId: string) => void
}): {
  readonly addCustomerContact: () => void
  readonly addCustomerPerson: () => void
  readonly addVendorCompany: () => void
  readonly addVendorPerson: () => void
} {
  function addCustomerContact(): void {
    const name = drafts.newCustomerName.trim()
    if (!name) return
    const existingMatches = matchingCustomerOptions(customerOptions, {
      name,
      email: drafts.newCustomerEmail,
      company: drafts.newCustomerCompany,
    })
    if (existingMatches.length > 1) {
      toast.error(
        "More than one contact matches. Choose the correct existing contact from the list."
      )
      return
    }
    const existing = existingMatches[0]
    if (existing) {
      applyDirectoryOption(existing)
      drafts.setShowNewCustomer(false)
      toast.info("That client contact already exists and was selected.")
      return
    }

    startTransition(async () => {
      const result = await createCustomerDirectoryContact({
        name,
        company: drafts.newCustomerCompany || null,
        email: drafts.newCustomerEmail || null,
        phone: drafts.newCustomerPhone || null,
        address: null,
        notes: null,
        relationshipType: drafts.newCustomerRelationship,
      })
      if (!result.success || !result.id || !result.customer) {
        toast.error(result.error)
        return
      }
      const customer = result.customer
      const option: ProjectContactDirectoryOption = {
        id: result.id,
        sourceType: "customer",
        displayName: customer.name,
        companyName: customer.company,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        suggestedContactType: "owner",
        identityManagedByActiveUser: false,
        customerContacts: [],
        vendorContacts: [],
      }
      setAvailableDirectoryOptions((current) =>
        current.some(
          (existingOption) =>
            existingOption.sourceType === "customer" &&
            existingOption.id === option.id
        )
          ? current
          : [...current, option]
      )
      applyDirectoryOption(option)
      drafts.setShowNewCustomer(false)
      drafts.setNewCustomerName("")
      drafts.setNewCustomerCompany("")
      drafts.setNewCustomerEmail("")
      drafts.setNewCustomerPhone("")
      drafts.setNewCustomerRelationship("client")
      toast.success(
        result.existing
          ? "Existing client/lead contact selected."
          : "Client/lead contact added to Contacts and selected."
      )
    })
  }

  function addCustomerPerson(): void {
    if (!selectedCustomer || !drafts.newCustomerPersonName.trim()) return
    const name = drafts.newCustomerPersonName.trim()
    const email = drafts.newCustomerPersonEmail.trim().toLowerCase()
    const phone = drafts.newCustomerPersonPhone
    const existing = findExistingNamedPerson(selectedCustomer.customerContacts, name)
    if (existing) {
      applyCustomerContact(existing.id)
      drafts.setShowNewCustomerPerson(false)
      toast.info("This person already exists and was selected.")
      return
    }
    startTransition(async () => {
      const result = await saveCustomerDirectoryPerson(selectedCustomer.id, null, {
        name,
        title: "",
        email,
        phone,
        isPrimary: selectedCustomer.customerContacts.length === 0,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const person = {
        id: result.id,
        name,
        title: null,
        email: email || null,
        phone: phone.trim() || null,
        isPrimary: selectedCustomer.customerContacts.length === 0,
        identityManagedByActiveUser: false,
      }
      setAvailableDirectoryOptions((current) => current.map((option) =>
        option.sourceType === "customer" && option.id === selectedCustomer.id
          ? { ...option, customerContacts: [...option.customerContacts, person] }
          : option
      ))
      setInput((current) => ({
        ...current,
        customerContactId: person.id,
        displayName: person.name,
        email: person.email ?? "",
        phone: person.phone ?? "",
      }))
      drafts.setNewCustomerPersonName("")
      drafts.setNewCustomerPersonEmail("")
      drafts.setNewCustomerPersonPhone("")
      drafts.setShowNewCustomerPerson(false)
      toast.success("Person saved in Contacts and selected for this project.")
    })
  }

  function addVendorCompany(): void {
    const name = drafts.newVendorName.trim()
    if (!name) return
    startTransition(async () => {
      const category =
        input.contactType === "supplier" ? "Supplier" : "Subcontractor"
      const result = await createVendor({
        name,
        category,
        email: "",
        phone: "",
        address: "",
        contacts: [],
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const option: ProjectContactDirectoryOption = {
        id: result.id,
        sourceType: "vendor",
        displayName: name,
        companyName: name,
        email: null,
        phone: null,
        address: null,
        suggestedContactType: input.contactType,
        identityManagedByActiveUser: false,
        customerContacts: [],
        vendorContacts: [],
      }
      setAvailableDirectoryOptions((current) => [...current, option])
      applyDirectoryOption(option)
      drafts.setNewVendorName("")
      drafts.setShowNewVendor(false)
      toast.success("Vendor company added.")
    })
  }

  function addVendorPerson(): void {
    if (!selectedVendor || !drafts.newVendorContactName.trim()) return
    startTransition(async () => {
      const result = await createVendorContact(selectedVendor.id, {
        id: null,
        name: drafts.newVendorContactName,
        title: drafts.newVendorContactTitle,
        email: drafts.newVendorContactEmail,
        phone: drafts.newVendorContactPhone,
        isPrimary: selectedVendor.vendorContacts.length === 0,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setAvailableDirectoryOptions((current) =>
        current.map((option) =>
          option.sourceType === "vendor" && option.id === selectedVendor.id
            ? {
                ...option,
                vendorContacts: [
                  ...option.vendorContacts,
                  {
                    id: result.contact.id,
                    name: result.contact.name,
                    title: result.contact.title,
                    email: result.contact.email,
                    phone: result.contact.phone,
                    isPrimary: result.contact.isPrimary,
                    identityManagedByActiveUser: false,
                  },
                ],
              }
            : option
        )
      )
      setInput((current) => ({
        ...current,
        vendorContactId: result.contact.id,
        displayName: result.contact.name,
        email: result.contact.email ?? "",
        phone: result.contact.phone ?? "",
      }))
      drafts.setNewVendorContactName("")
      drafts.setNewVendorContactTitle("")
      drafts.setNewVendorContactEmail("")
      drafts.setNewVendorContactPhone("")
      drafts.setShowNewVendorContact(false)
      toast.success("Vendor contact added.")
    })
  }

  return { addCustomerContact, addCustomerPerson, addVendorCompany, addVendorPerson }
}
