"use client"

import { IconPlus } from "@tabler/icons-react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { DirectoryPicker } from "./contact-editor-pickers"
import type { ProjectContactEditorState } from "./use-project-contact-editor"

/** Owner/customer: client company, named person and quick adds. */
export function ContactOwnerSection({
  editor,
}: {
  readonly editor: ProjectContactEditorState
}): React.ReactElement {
  const {
    input,
    drafts,
    directoryOpenKey,
    customerOptions,
    selectedDirectory,
    selectedCustomer,
    directoryLoading,
    isPending,
    refreshDirectory,
    applyDirectoryOption,
    applyCustomerContact,
    addCustomerContact,
    addCustomerPerson,
  } = editor
  const {
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
  } = drafts
  return (
              <div className="grid gap-4 rounded-lg border p-4">
                <div className="grid gap-2">
                  <Label>Client contact</Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? "customer"}
                    options={customerOptions}
                    selected={selectedDirectory}
                    onSelect={applyDirectoryOption}
                    placeholder="Choose a client or lead contact..."
                    searchPlaceholder="Search client and lead contacts..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Choose the client company, then a named person. Selection does not grant project access.
                  </p>
                  <Button type="button" size="sm" variant="ghost" className="w-fit" disabled={directoryLoading} onClick={() => void refreshDirectory()}>
                    {directoryLoading ? "Refreshing…" : "Refresh directory"}
                  </Button>
                </div>
                {selectedCustomer && (
                  <div className="grid gap-2 border-t pt-4">
                    <Label>Client contact person</Label>
                    <SearchableCombobox
                      value={input.customerContactId ?? "company-only"}
                      onValueChange={(value) => {
                        if (value !== "") applyCustomerContact(value)
                      }}
                      options={[
                        { value: "company-only", label: "No specific person (company assignment only)" },
                        ...selectedCustomer.customerContacts.map((person) => ({
                          value: person.id,
                          label: person.isPrimary ? `${person.name} · Primary` : person.name,
                          description: [person.title, person.email].filter(Boolean).join(" · ") || undefined,
                          keywords: person.email ?? undefined,
                        })),
                      ]}
                      ariaLabel="Client contact person"
                      placeholder="Choose a person"
                      searchPlaceholder="Search by name, title or email..."
                      emptyMessage="No matching people."
                    />
                    <p className="text-xs text-muted-foreground">
                      Select a directory person when this project needs a named
                      owner contact. Existing company-linked invitation behavior
                      remains available until legacy contacts are reconciled.
                    </p>
                    {showNewCustomerPerson ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input value={newCustomerPersonName} onChange={(event) => setNewCustomerPersonName(event.target.value)} placeholder="Person name" aria-label="Person name" />
                        <Input type="email" value={newCustomerPersonEmail} onChange={(event) => setNewCustomerPersonEmail(event.target.value)} placeholder="Email" aria-label="Person email" />
                        <Input type="tel" value={newCustomerPersonPhone} onChange={(event) => setNewCustomerPersonPhone(event.target.value)} placeholder="Phone" aria-label="Person phone" />
                        <div className="flex gap-2">
                          <Button type="button" disabled={isPending || !newCustomerPersonName.trim()} onClick={addCustomerPerson}>Add person</Button>
                          <Button type="button" variant="ghost" onClick={() => setShowNewCustomerPerson(false)}>Cancel</Button>
                        </div>
                      </div>
                    ) : <Button type="button" variant="outline" className="w-fit" onClick={() => setShowNewCustomerPerson(true)}><IconPlus className="size-4" />Add person at this client</Button>}
                  </div>
                )}
                {showNewCustomer ? (
                  <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
                    <Input
                      required
                      value={newCustomerName}
                      onChange={(event) => setNewCustomerName(event.target.value)}
                      placeholder="Contact name"
                    />
                    <Input
                      value={newCustomerCompany}
                      onChange={(event) => setNewCustomerCompany(event.target.value)}
                      placeholder="Company / organization"
                    />
                    <Input
                      type="email"
                      value={newCustomerEmail}
                      onChange={(event) => setNewCustomerEmail(event.target.value)}
                      placeholder="Email"
                    />
                    <Input
                      type="tel"
                      value={newCustomerPhone}
                      onChange={(event) => setNewCustomerPhone(event.target.value)}
                      placeholder="Phone"
                    />
                    <Select
                      value={newCustomerRelationship}
                      onValueChange={(value) => {
                        if (value === "client" || value === "lead") {
                          setNewCustomerRelationship(value)
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Client or lead" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="client">Client</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={addCustomerContact}
                        disabled={isPending || !newCustomerName.trim()}
                      >
                        Add client company
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowNewCustomer(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setShowNewCustomer(true)}
                  >
                    <IconPlus className="size-4" />
                    Add new client company
                  </Button>
                )}
              </div>
  )
}
