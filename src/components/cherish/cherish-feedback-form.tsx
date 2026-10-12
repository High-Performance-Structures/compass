"use client"

import { useState, useTransition } from "react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  submitCherishPulseResponse,
  type CherishPulseResponseType,
  type CherishValue,
} from "@/app/actions/cherish-pulse"
import type { CherishRecipientOption } from "@/app/actions/cherish-recipients"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export const CHERISH_VALUES: readonly CherishValue[] = [
  "Camaraderie",
  "Honor",
  "Excellence",
  "Reliability",
  "Integrity",
  "Servitude",
  "Humility",
]

export const CHERISH_RESPONSE_TYPES: readonly {
  readonly value: CherishPulseResponseType
  readonly label: string
}[] = [
  { value: "shoutout", label: "Shoutout" },
  { value: "win", label: "Project win" },
  { value: "concern", label: "Private concern" },
]

const COMPANY_RECIPIENT = "company"

export function CherishFeedbackForm({
  recipients,
}: {
  readonly recipients: readonly CherishRecipientOption[]
}): React.ReactElement {
  const [cherishValue, setCherishValue] =
    useState<CherishValue>("Reliability")
  const [responseType, setResponseType] =
    useState<CherishPulseResponseType>("shoutout")
  const [message, setMessage] = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const [recipientId, setRecipientId] = useState(COMPANY_RECIPIENT)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submitResponse(): void {
    const trimmedMessage = message.trim()
    if (trimmedMessage.length < 3) {
      setFeedback("Add a little more detail before submitting.")
      return
    }

    if (trimmedMessage.length > 1_200) {
      setFeedback("Keep CHERISH responses under 1,200 characters.")
      return
    }

    startTransition(async () => {
      setFeedback(null)
      const result = await submitCherishPulseResponse({
        cherishValue,
        responseType,
        message: trimmedMessage,
        source: "compass_dashboard",
        anonymous,
        recipientId:
          responseType === "shoutout" && recipientId !== COMPANY_RECIPIENT
            ? recipientId
            : undefined,
      })

      if (!result.success) {
        setFeedback(result.error)
        return
      }

      setMessage("")
      setAnonymous(false)
      setRecipientId(COMPANY_RECIPIENT)
      const selectedRecipient = recipients.find(
        (recipient) => recipient.id === recipientId,
      )
      setFeedback(
        responseType === "concern"
          ? "Saved privately for leadership review."
          : selectedRecipient
            ? `Saved${anonymous ? " anonymously" : ""} for review. Only ${selectedRecipient.name} will receive it after approval.`
            : anonymous
              ? "Saved anonymously to the CHERISH review queue."
              : "Saved to the CHERISH review queue.",
      )
    })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        submitResponse()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            CHERISH value
          </label>
          <SearchableCombobox
            value={cherishValue}
            onValueChange={(value) => {
              const nextValue = CHERISH_VALUES.find(
                (candidate) => candidate === value,
              )
              if (nextValue) setCherishValue(nextValue)
            }}
            options={CHERISH_VALUES.map((value) => ({ value, label: value }))}
            ariaLabel="CHERISH value"
            placeholder="Choose a value"
            searchPlaceholder="Search values..."
            emptyMessage="No matching values."
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Response type
          </label>
          <Select
            value={responseType}
            onValueChange={(value) => {
              const nextType = CHERISH_RESPONSE_TYPES.find(
                (candidate) => candidate.value === value,
              )
              if (nextType) setResponseType(nextType.value)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHERISH_RESPONSE_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {responseType === "shoutout" ? (
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Who should see this?
          </label>
          <SearchableCombobox
            ariaDescribedBy="cherish-recipient-description"
            value={recipientId}
            onValueChange={(value) => setRecipientId(value || COMPANY_RECIPIENT)}
            options={[
              { value: COMPANY_RECIPIENT, label: "Whole company" },
              ...recipients.map((recipient) => ({
                value: recipient.id,
                label: recipient.name,
              })),
            ]}
            ariaLabel="Who should see this?"
            placeholder="Whole company"
            searchPlaceholder="Search people..."
            emptyMessage="No matching people."
          />
          <p
            id="cherish-recipient-description"
            className="mt-1.5 text-xs text-muted-foreground"
          >
            {recipientId === COMPANY_RECIPIENT
              ? "After approval, everyone can see this story."
              : "After approval, only the selected employee can see this story."}
          </p>
        </div>
      ) : null}

      <div>
        <label className="mb-1.5 block text-sm font-medium">Message</label>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            responseType === "concern"
              ? "What should leadership know?"
              : "What happened, and who helped?"
          }
          className="min-h-32 resize-y"
          maxLength={1_200}
        />
      </div>

      <label className="flex items-start gap-3 border-y py-3 text-sm">
        <Checkbox
          checked={anonymous}
          onCheckedChange={(checked) => setAnonymous(checked === true)}
          aria-describedby="cherish-anonymous-description"
        />
        <span>
          <span className="block font-medium">Submit anonymously</span>
          <span
            id="cherish-anonymous-description"
            className="mt-0.5 block text-muted-foreground"
          >
            Your name will not appear in CHERISH review, dashboard
            stories, or Field App recognition.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p
          className={cn(
            "text-sm",
            feedback?.startsWith("Saved")
              ? "text-muted-foreground"
              : feedback
                ? "text-destructive"
                : "text-muted-foreground",
          )}
          role="status"
        >
          {feedback ??
            (responseType === "concern"
              ? "Private concerns are visible only to staff granted CHERISH review access."
              : recipientId === COMPANY_RECIPIENT
                ? "Company stories appear after authorized review and approval."
                : "Only the selected employee will see this after approval.")}
        </p>
        <Button
          type="submit"
          disabled={isPending || message.trim().length < 3}
        >
          {isPending ? "Saving..." : "Submit CHERISH feedback"}
        </Button>
      </div>
    </form>
  )
}
