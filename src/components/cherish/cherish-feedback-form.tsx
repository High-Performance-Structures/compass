"use client"

import { useMemo, useState, useTransition } from "react"

import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  submitCherishPulseResponse,
  type CherishPulseResponseType,
  type CherishValue,
} from "@/app/actions/cherish-pulse"
import type { CherishRecipientOption } from "@/app/actions/cherish-recipients"
import { CherishValueField } from "@/components/cherish/cherish-value-field"
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
import { suggestCherishValue } from "@/lib/cherish/value-suggestion"
import { cn } from "@/lib/utils"

const CHERISH_RESPONSE_TYPES: readonly {
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
  // Nothing is preselected: the value is the person's choice, or else the
  // one suggested from what they wrote.
  const [chosenValue, setChosenValue] = useState<CherishValue | null>(null)
  const [responseType, setResponseType] =
    useState<CherishPulseResponseType>("shoutout")
  const [message, setMessage] = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const [recipientId, setRecipientId] = useState(COMPANY_RECIPIENT)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const suggestedValue = useMemo(() => suggestCherishValue(message), [message])
  const cherishValue = chosenValue ?? suggestedValue

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

    if (!cherishValue) {
      setFeedback("Choose the CHERISH value that fits best.")
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
      setChosenValue(null)
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
      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
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

      <CherishValueField
        id="cherish-value"
        value={cherishValue}
        suggested={suggestedValue}
        chosen={chosenValue !== null}
        hasMessage={message.trim().length >= 3}
        onChoose={setChosenValue}
      />

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
          disabled={isPending || message.trim().length < 3 || !cherishValue}
        >
          {isPending ? "Saving..." : "Submit CHERISH feedback"}
        </Button>
      </div>
    </form>
  )
}
