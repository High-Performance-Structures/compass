"use client"

import * as React from "react"
import { IconQuestionMark } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import { createSubVendorRfi } from "@/app/actions/project-audience-sub-vendor"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectAudienceMessageRecipient } from "@/lib/project-audience-direct-message"

type SubmitState =
  | { readonly kind: "idle" }
  | { readonly kind: "error"; readonly message: string }

export function ProjectAudienceRfiCreateDialog({
  projectId,
  recipients,
  viewerIsInternal,
}: {
  readonly projectId: string
  readonly recipients: readonly ProjectAudienceMessageRecipient[]
  readonly viewerIsInternal: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [subject, setSubject] = React.useState("")
  const [question, setQuestion] = React.useState("")
  const [priority, setPriority] = React.useState("normal")
  const [recipientUserId, setRecipientUserId] = React.useState(
    recipients[0]?.userId ?? ""
  )
  const [state, setState] = React.useState<SubmitState>({ kind: "idle" })
  const unavailable = recipients.length === 0

  function reset(): void {
    setSubject("")
    setQuestion("")
    setPriority("normal")
    setRecipientUserId(recipients[0]?.userId ?? "")
    setState({ kind: "idle" })
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setState({ kind: "idle" })
    if (viewerIsInternal) {
      setState({
        kind: "error",
        message:
          "Preview mode shows the partner form, but only an assigned sub/vendor can create the live RFI.",
      })
      return
    }
    startTransition(async () => {
      const result = await createSubVendorRfi(projectId, {
        subject,
        question,
        priority,
        recipientUserId,
      })
      if (!result.success) {
        setState({ kind: "error", message: result.error })
        return
      }
      setOpen(false)
      reset()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          disabled={unavailable}
          title={
            recipients.length === 0
              ? "Add an active internal staff member first."
              : viewerIsInternal
                ? "Preview the RFI form an assigned sub/vendor can send."
                : undefined
          }
        >
          <IconQuestionMark className="size-4" />
          Send an RFI
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Send a request for information</DialogTitle>
            <DialogDescription>
              Route a project question directly to an assigned internal team
              member. The response will remain visible in this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4">
            {viewerIsInternal && (
              <p className="border bg-muted/40 p-3 text-sm text-muted-foreground">
                Preview mode: this is the form an assigned sub/vendor can send.
                Submitting is blocked here so an internal staff account cannot be
                recorded as the external requester.
              </p>
            )}
            <label className="grid gap-1.5 text-sm font-medium">
              Send to
              <Select value={recipientUserId} onValueChange={setRecipientUserId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a project team member" />
                </SelectTrigger>
                <SelectContent>
                  {recipients.map((recipient) => (
                    <SelectItem key={recipient.userId} value={recipient.userId}>
                      {recipient.displayName}
                      {recipient.role ? ` · ${recipient.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Subject
              <Input
                value={subject}
                onChange={(event) => setSubject(event.currentTarget.value)}
                maxLength={240}
                placeholder="Example: Roof curb detail at grid C4"
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Question
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
                maxLength={10_000}
                className="min-h-32"
                placeholder="Describe the decision or clarification your team needs."
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Priority
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {state.kind === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {state.message}
              </p>
            )}
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !recipientUserId}>
              {pending ? "Sending..." : "Send RFI"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
