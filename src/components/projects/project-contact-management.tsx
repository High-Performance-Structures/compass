"use client"

import {
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import type {
  ProjectContactDirectoryOption,
  ProjectContactItem,
  ProjectContactSageOptions,
} from "@/lib/domain/contacts/types"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

import { ContactDetailsFields } from "./contact-editor/contact-details-fields"
import { DirectoryPicker } from "./contact-editor/contact-editor-pickers"
import {
  inputWithContactType,
  isProjectContactType,
  isVendorContactType,
} from "./contact-editor/contact-editor-rules"
import { ContactOwnerSection } from "./contact-editor/contact-owner-section"
import { ContactVendorSection } from "./contact-editor/contact-vendor-section"
import { useProjectContactEditor } from "./contact-editor/use-project-contact-editor"

export function ProjectContactEditor({
  projectId,
  contact = null,
  directoryOptions,
  sageOptions,
}: {
  readonly projectId: string
  readonly contact?: ProjectContactItem | null
  readonly directoryOptions: readonly ProjectContactDirectoryOption[]
  readonly sageOptions: ProjectContactSageOptions
}): React.ReactElement {
  const editor = useProjectContactEditor({
    projectId,
    contact,
    directoryOptions,
    sageOptions,
  })
  const {
    open,
    setOpen,
    directoryOpenKey,
    availableDirectoryOptions,
    input,
    setInput,
    setCustomRoleSelected,
    isPending,
    selectedDirectory,
    identityManagedByActiveUser,
    resetEditor,
    applyDirectoryOption,
    submit,
    remove,
  } = editor
  const isEditing = contact !== null

  return (
    <Sheet open={open} onOpenChange={resetEditor}>
      <SheetTrigger asChild>
        <Button type="button" size={isEditing ? "icon-sm" : "sm"} variant={isEditing ? "outline" : "default"}>
          {isEditing ? <IconPencil className="size-4" /> : <IconPlus className="size-4" />}
          {!isEditing && "Add contact"}
          {isEditing && <span className="sr-only">Edit {contact.displayName}</span>}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>{isEditing ? "Edit project contact" : "Add project contact"}</SheetTitle>
            <SheetDescription>
              {identityManagedByActiveUser
                ? "Contact details are managed in Contacts; Sage-linked changes require review. Project role and visibility remain editable here."
                : selectedDirectory
                  ? "Phone, email, and address stay synchronized with the linked directory record."
                  : "Add a project contact or link an existing directory record."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid flex-1 gap-5 px-4 py-5 sm:px-6">
            <div className="grid gap-2">
              <Label htmlFor="project-contact-type">Contact type</Label>
              <Select
                value={input.contactType}
                onValueChange={(value) => {
                  if (!isProjectContactType(value)) {
                    return
                  }
                  const keepVendor =
                    isVendorContactType(input.contactType) &&
                    isVendorContactType(value)
                  setInput((current) => inputWithContactType(current, value, keepVendor))
                  setCustomRoleSelected(false)
                }}
              >
                <SelectTrigger id="project-contact-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner / customer</SelectItem>
                  <SelectItem value="supplier">Supplier</SelectItem>
                  <SelectItem value="subcontractor">Subcontractor</SelectItem>
                  <SelectItem value="internal">Internal team</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isVendorContactType(input.contactType) ? (
              <ContactVendorSection editor={editor} />
            ) : input.contactType === "owner" ? (
              <ContactOwnerSection editor={editor} />
            ) : (
              !isEditing && (
                <div className="grid gap-2">
                  <Label>Internal contact directory</Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? "internal"}
                    options={availableDirectoryOptions.filter(
                      (option) => option.sourceType === "team"
                    )}
                    selected={selectedDirectory}
                    onSelect={applyDirectoryOption}
                    placeholder="Choose an internal contact..."
                    searchPlaceholder="Search internal contacts..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Internal contacts are shared across projects. People already
                    on this project remain visible but cannot be added twice.
                  </p>
                </div>
              )
            )}

            <ContactDetailsFields
              editor={editor}
              contact={contact}
              sageOptions={sageOptions}
            />
          </div>

          <SheetFooter className="border-t px-4 py-4 sm:px-6">
            {isEditing && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" className="sm:mr-auto">
                    <IconTrash className="size-4" />
                    Remove from project
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {contact.displayName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the contact and any Compass access to this project. It does not delete the customer, vendor, or staff directory record, and imported source history is preserved for review.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending}
                      onClick={remove}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove contact
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                !input.displayName.trim() ||
                (isVendorContactType(input.contactType) && !input.vendorId)
              }
            >
              {isPending ? "Saving..." : "Save contact"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
