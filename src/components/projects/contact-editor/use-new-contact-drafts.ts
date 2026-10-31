"use client"

import { useState } from "react"

import type { CustomerRelationshipType } from "@/app/actions/customers"

/** The inline "add new client / person / vendor / vendor person" drafts. */
export function useNewContactDrafts() {
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [showNewCustomerPerson, setShowNewCustomerPerson] = useState(false)
  const [newCustomerPersonName, setNewCustomerPersonName] = useState("")
  const [newCustomerPersonEmail, setNewCustomerPersonEmail] = useState("")
  const [newCustomerPersonPhone, setNewCustomerPersonPhone] = useState("")
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerCompany, setNewCustomerCompany] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerRelationship, setNewCustomerRelationship] =
    useState<CustomerRelationshipType>("client")
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState("")
  const [showNewVendorContact, setShowNewVendorContact] = useState(false)
  const [newVendorContactName, setNewVendorContactName] = useState("")
  const [newVendorContactTitle, setNewVendorContactTitle] = useState("")
  const [newVendorContactEmail, setNewVendorContactEmail] = useState("")
  const [newVendorContactPhone, setNewVendorContactPhone] = useState("")

  /** Clears every draft, as when the editor opens. */
  function resetDrafts(): void {
    setShowNewCustomer(false)
    setShowNewCustomerPerson(false)
    setNewCustomerPersonName("")
    setNewCustomerPersonEmail("")
    setNewCustomerPersonPhone("")
    setNewCustomerName("")
    setNewCustomerCompany("")
    setNewCustomerEmail("")
    setNewCustomerPhone("")
    setNewCustomerRelationship("client")
    setShowNewVendor(false)
    setNewVendorName("")
    setShowNewVendorContact(false)
    setNewVendorContactName("")
    setNewVendorContactTitle("")
    setNewVendorContactEmail("")
    setNewVendorContactPhone("")
  }

  return {
    showNewCustomer,
    setShowNewCustomer,
    showNewCustomerPerson,
    setShowNewCustomerPerson,
    newCustomerPersonName,
    setNewCustomerPersonName,
    newCustomerPersonEmail,
    setNewCustomerPersonEmail,
    newCustomerPersonPhone,
    setNewCustomerPersonPhone,
    newCustomerName,
    setNewCustomerName,
    newCustomerCompany,
    setNewCustomerCompany,
    newCustomerEmail,
    setNewCustomerEmail,
    newCustomerPhone,
    setNewCustomerPhone,
    newCustomerRelationship,
    setNewCustomerRelationship,
    showNewVendor,
    setShowNewVendor,
    newVendorName,
    setNewVendorName,
    showNewVendorContact,
    setShowNewVendorContact,
    newVendorContactName,
    setNewVendorContactName,
    newVendorContactTitle,
    setNewVendorContactTitle,
    newVendorContactEmail,
    setNewVendorContactEmail,
    newVendorContactPhone,
    setNewVendorContactPhone,
    resetDrafts,
  }
}

export type NewContactDrafts = ReturnType<typeof useNewContactDrafts>
