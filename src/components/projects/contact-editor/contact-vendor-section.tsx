"use client"

import { IconPlus } from "@tabler/icons-react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { DirectoryPicker } from "./contact-editor-pickers"
import type { ProjectContactEditorState } from "./use-project-contact-editor"

/** Supplier/subcontractor: vendor company, contact person and quick adds. */
export function ContactVendorSection({
  editor,
}: {
  readonly editor: ProjectContactEditorState
}): React.ReactElement {
  const {
    input,
    drafts,
    directoryOpenKey,
    vendorOptions,
    selectedVendor,
    legacyVendorPerson,
    isPending,
    applyDirectoryOption,
    applyVendorContact,
    addVendorCompany,
    addVendorPerson,
  } = editor
  const {
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
  } = drafts
  return (
              <div className="grid gap-4 rounded-lg border p-4">
                <div className="grid gap-2">
                  <Label>Vendor company</Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? "vendor"}
                    options={vendorOptions}
                    selected={selectedVendor}
                    onSelect={applyDirectoryOption}
                    placeholder="Choose a vendor company..."
                    searchPlaceholder="Search vendor companies..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Choose from all {vendorOptions.length} vendor companies.
                  </p>
                </div>
                {showNewVendor ? (
                  <div className="flex gap-2">
                    <Input
                      value={newVendorName}
                      onChange={(event) => setNewVendorName(event.target.value)}
                      placeholder="New vendor company name"
                      aria-label="New vendor company name"
                    />
                    <Button
                      type="button"
                      onClick={addVendorCompany}
                      disabled={isPending || !newVendorName.trim()}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowNewVendor(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setShowNewVendor(true)}
                  >
                    <IconPlus className="size-4" />
                    Add new vendor
                  </Button>
                )}

                {selectedVendor && (
                  <div className="grid gap-3 border-t pt-4">
                    <div className="grid gap-2">
                      <Label>Contact person</Label>
                      <SearchableCombobox
                        value={
                          input.vendorContactId ??
                          (legacyVendorPerson ? "legacy-person" : "company-only")
                        }
                        // The picker's empty reset must not overwrite the contact details.
                        onValueChange={(value) => {
                          if (value !== "") applyVendorContact(value)
                        }}
                        options={[
                          { value: "company-only", label: "No specific person (company assignment only)" },
                          ...(legacyVendorPerson
                            ? [{ value: "legacy-person", label: legacyVendorPerson, description: "Imported contact" }]
                            : []),
                          ...selectedVendor.vendorContacts.map((vendorContact) => ({
                            value: vendorContact.id,
                            label: vendorContact.isPrimary ? `${vendorContact.name} · Primary` : vendorContact.name,
                            description: [vendorContact.title, vendorContact.email].filter(Boolean).join(" · ") || undefined,
                            keywords: vendorContact.email ?? undefined,
                          })),
                        ]}
                        ariaLabel="Contact person"
                        placeholder="Choose a person"
                        searchPlaceholder="Search by name, title or email..."
                        emptyMessage="No matching people."
                      />
                      <p className="text-xs text-muted-foreground">
                        Select a person when project access or email invitations are needed.
                        Company-only assignments cannot be invited.
                      </p>
                    </div>
                    {showNewVendorContact ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          required
                          value={newVendorContactName}
                          onChange={(event) =>
                            setNewVendorContactName(event.target.value)
                          }
                          placeholder="Contact name"
                        />
                        <Input
                          value={newVendorContactTitle}
                          onChange={(event) =>
                            setNewVendorContactTitle(event.target.value)
                          }
                          placeholder="Title / position"
                        />
                        <Input
                          type="email"
                          value={newVendorContactEmail}
                          onChange={(event) =>
                            setNewVendorContactEmail(event.target.value)
                          }
                          placeholder="Email"
                        />
                        <Input
                          type="tel"
                          value={newVendorContactPhone}
                          onChange={(event) =>
                            setNewVendorContactPhone(event.target.value)
                          }
                          placeholder="Phone"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={addVendorPerson}
                            disabled={isPending || !newVendorContactName.trim()}
                          >
                            Add person
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setShowNewVendorContact(false)}
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
                        onClick={() => setShowNewVendorContact(true)}
                      >
                        <IconPlus className="size-4" />
                        Add contact person
                      </Button>
                    )}
                  </div>
                )}
              </div>
  )
}
