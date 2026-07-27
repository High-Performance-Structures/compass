"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { IconMailForward } from "@tabler/icons-react"
import { toast } from "sonner"

import { sendProjectAccessInvitation } from "@/app/actions/project-access-invitations"
import type { ProjectContactItem } from "@/app/actions/project-contacts"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { projectAccessWelcomeTemplate } from "@/lib/email/project-access-welcome"
import { cn } from "@/lib/utils"

type InvitableContact = ProjectContactItem & {
  readonly email: string
}

function isInvitableContact(
  contact: ProjectContactItem
): contact is InvitableContact {
  return Boolean(contact.email?.trim())
}

function accessLabel(contactType: ProjectContactItem["contactType"]): string {
  if (contactType === "owner") return "Owner / Client"
  if (contactType === "supplier") return "Supplier"
  if (contactType === "subcontractor") return "Subcontractor"
  return "Internal Staff"
}

export function ProjectContactInviteLauncher({
  projectId,
  projectLabel,
  contacts,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly contacts: readonly ProjectContactItem[]
}): React.ReactElement | null {
  const eligibleContacts = contacts.filter(isInvitableContact)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [contactPickerOpen, setContactPickerOpen] = React.useState(false)
  const [selectedContactId, setSelectedContactId] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [message, setMessage] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const selectedContact =
    eligibleContacts.find((contact) => contact.id === selectedContactId) ?? null

  if (eligibleContacts.length === 0) return null

  const selectContact = (contact: InvitableContact): void => {
    const template = projectAccessWelcomeTemplate({
      recipientName: contact.displayName,
      projectLabel,
    })
    setSelectedContactId(contact.id)
    setSubject(template.subject)
    setMessage(template.message)
    setContactPickerOpen(false)
  }

  const handleOpenChange = (open: boolean): void => {
    setSheetOpen(open)
    if (!open) {
      setContactPickerOpen(false)
      setSelectedContactId("")
      setSubject("")
      setMessage("")
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!selectedContact) return

    setSending(true)
    try {
      const result = await sendProjectAccessInvitation({
        projectId,
        contactId: selectedContact.id,
        subject,
        message,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }

      if (result.warning) toast.warning(result.warning)
      else if (result.accessStatus === "access_granted") {
        toast.success("Project access granted and welcome email sent")
      } else {
        toast.success("Compass invitation and welcome email sent")
      }
      handleOpenChange(false)
    } catch {
      toast.error("Unable to send the Compass invitation")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setSheetOpen(true)}>
        <IconMailForward className="size-4" />
        Invite contact
      </Button>

      <Sheet open={sheetOpen} onOpenChange={handleOpenChange}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
          <SheetHeader className="border-b pb-4 text-left">
            <SheetTitle>Invite a project contact</SheetTitle>
            <SheetDescription>
              Choose a contact, review the welcome email, and grant access to
              this project only.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 py-5">
            <div className="space-y-2 border-b pb-5">
              <Label>Contact</Label>
              <Popover
                open={contactPickerOpen}
                onOpenChange={setContactPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={contactPickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={sending}
                  >
                    <span
                      className={cn(
                        "truncate",
                        !selectedContact && "text-muted-foreground"
                      )}
                    >
                      {selectedContact
                        ? `${selectedContact.displayName} - ${accessLabel(selectedContact.contactType)}`
                        : "Search project contacts..."}
                    </span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                >
                  <Command>
                    <CommandInput placeholder="Search name, company, or email..." />
                    <CommandList className="max-h-[320px]">
                      <CommandEmpty>
                        No eligible project contacts found.
                      </CommandEmpty>
                      <CommandGroup>
                        {eligibleContacts.map((contact) => (
                          <CommandItem
                            key={contact.id}
                            value={[
                              contact.displayName,
                              contact.companyName,
                              contact.email,
                              accessLabel(contact.contactType),
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onSelect={() => selectContact(contact)}
                          >
                            <Check
                              className={cn(
                                "size-4",
                                selectedContactId === contact.id
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {contact.displayName}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {accessLabel(contact.contactType)} ·{" "}
                                {contact.email}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedContact && (
              <>
                <div className="grid gap-x-5 gap-y-3 border-b pb-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Recipient
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {selectedContact.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedContact.email}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Access
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {accessLabel(selectedContact.contactType)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {projectLabel} only
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="project-invite-subject">Email subject</Label>
                  <Input
                    id="project-invite-subject"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    disabled={sending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="project-invite-message">
                    Welcome message
                  </Label>
                  <Textarea
                    id="project-invite-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    disabled={sending}
                    className="min-h-[360px] resize-y leading-relaxed"
                  />
                </div>
              </>
            )}

            <p className="border-t pt-4 text-xs text-muted-foreground">
              Existing Compass users receive this project assignment
              immediately. New users receive a secure account invitation. No
              other project access is added.
            </p>
          </div>

          <SheetFooter className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSend}
              disabled={
                sending ||
                !selectedContact ||
                !subject.trim() ||
                !message.trim()
              }
            >
              {sending ? "Sending..." : "Send Welcome and Access"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
