"use client"

import { useState, useTransition } from "react"

import {
  submitCherishPulseResponse,
  type CherishPulseResponseType,
  type CherishValue,
} from "@/app/actions/cherish-pulse"
import { Button } from "@/components/ui/button"
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

export function CherishFeedbackForm(): React.ReactElement {
  const [cherishValue, setCherishValue] =
    useState<CherishValue>("Reliability")
  const [responseType, setResponseType] =
    useState<CherishPulseResponseType>("shoutout")
  const [message, setMessage] = useState("")
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
      })

      if (!result.success) {
        setFeedback(result.error)
        return
      }

      setMessage("")
      setFeedback(
        responseType === "concern"
          ? "Saved privately for leadership review."
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
          <Select
            value={cherishValue}
            onValueChange={(value) => {
              const nextValue = CHERISH_VALUES.find(
                (candidate) => candidate === value,
              )
              if (nextValue) setCherishValue(nextValue)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHERISH_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              ? "Private concerns are visible only to Executive Admin reviewers."
              : "Team responses appear after Executive Admin approval.")}
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
