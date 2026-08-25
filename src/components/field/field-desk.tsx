"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import {
  IconCloudCheck,
  IconCloudOff,
  IconHeartHandshake,
  IconMessageCircle,
} from "@tabler/icons-react"

import {
  submitCherishPulseResponse,
  type CherishPulseResponseType,
  type CherishValue,
} from "@/app/actions/cherish-pulse"
import { useChatPanel } from "@/components/agent/chat-provider"
import { CherishRecognitionTicker } from "@/components/cherish/cherish-recognition-ticker"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  createCherishPulseOutboxItem,
  enqueueFieldOutboxItem,
  FIELD_OUTBOX_CHANGED_EVENT,
  listFieldOutboxItems,
} from "@/lib/field/offline-outbox"
import type { FieldCherishRecognition } from "@/lib/field/types"
import { cn } from "@/lib/utils"

const CHERISH_VALUES: readonly CherishValue[] = [
  "Camaraderie",
  "Honor",
  "Excellence",
  "Reliability",
  "Integrity",
  "Servitude",
  "Humility",
]

const RESPONSE_TYPES: readonly {
  readonly value: CherishPulseResponseType
  readonly label: string
}[] = [
  { value: "shoutout", label: "Shoutout" },
  { value: "win", label: "Project win" },
  { value: "concern", label: "Private concern" },
]

export function FieldDesk({
  offlineScopeKey,
  displayName,
  cherishRecognitions,
}: {
  readonly offlineScopeKey: string
  readonly displayName: string
  readonly cherishRecognitions: readonly FieldCherishRecognition[]
}): React.ReactElement {
  const chatPanel = useChatPanel()
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [cherishValue, setCherishValue] =
    useState<CherishValue>("Reliability")
  const [responseType, setResponseType] =
    useState<CherishPulseResponseType>("shoutout")
  const [message, setMessage] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    function refresh(): void {
      setOnline(navigator.onLine)
      setPendingCount(listFieldOutboxItems(offlineScopeKey).length)
    }

    function handleOutboxChanged(event: Event): void {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (
        typeof detail === "object" &&
        detail !== null &&
        "scopeKey" in detail &&
        detail.scopeKey === offlineScopeKey
      ) {
        refresh()
      }
    }

    refresh()
    window.addEventListener("online", refresh)
    window.addEventListener("offline", refresh)
    window.addEventListener(FIELD_OUTBOX_CHANGED_EVENT, handleOutboxChanged)
    return () => {
      window.removeEventListener("online", refresh)
      window.removeEventListener("offline", refresh)
      window.removeEventListener(FIELD_OUTBOX_CHANGED_EVENT, handleOutboxChanged)
    }
  }, [offlineScopeKey])

  function queueCherishResponse(
    trimmedMessage: string,
    submissionId: string,
  ): boolean {
    return enqueueFieldOutboxItem(
      offlineScopeKey,
      createCherishPulseOutboxItem({
        id: submissionId,
        cherishValue,
        responseType,
        message: trimmedMessage,
      }),
    )
  }

  function resetForm(): void {
    setMessage("")
    setFeedback(null)
  }

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

    const submissionId = crypto.randomUUID()
    if (!navigator.onLine) {
      if (queueCherishResponse(trimmedMessage, submissionId)) {
        resetForm()
        setFeedback(
          "Saved on this device. The response will sync when service returns.",
        )
      } else {
        setFeedback("Unable to save this response for later.")
      }
      return
    }

    startTransition(async () => {
      setFeedback(null)
      try {
        const result = await submitCherishPulseResponse({
          cherishValue,
          responseType,
          message: trimmedMessage,
          source: "compass_mobile",
          clientSubmissionId: submissionId,
        })
        if (!result.success) {
          setFeedback(result.error)
          return
        }

        resetForm()
        setFeedback(
          responseType === "concern"
            ? "Saved privately for leadership review."
            : "Saved to the CHERISH review queue.",
        )
      } catch {
        if (queueCherishResponse(trimmedMessage, submissionId)) {
          resetForm()
          setFeedback(
            "Connection was interrupted. The response is saved for automatic sync.",
          )
        } else {
          setFeedback("Unable to save this response.")
        }
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
      <header className="border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Field Desk</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome, {displayName}
            </h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div
              className={cn(
                "flex items-center gap-2 text-sm",
                online ? "text-emerald-700" : "text-amber-700",
              )}
            >
              {online ? (
                <IconCloudCheck className="size-5" />
              ) : (
                <IconCloudOff className="size-5" />
              )}
              <span>{online ? "Online" : "Offline — changes will sync later"}</span>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/projects">Full Compass</Link>
            </Button>
          </div>
        </div>
        {pendingCount > 0 && (
          <p className="mt-2 text-sm text-amber-700">
            {pendingCount} field {pendingCount === 1 ? "item" : "items"} pending
            sync on this device.
          </p>
        )}
      </header>

      <CherishRecognitionTicker
        items={cherishRecognitions}
        className="mt-4"
      />

      <section className="grid gap-3 border-b py-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <IconMessageCircle className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Ask Jarvis</h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Ask a project question or describe something that needs follow-up.
            Text messages written without service stay on this device and send
            automatically after reconnection.
          </p>
        </div>
        <Button type="button" onClick={chatPanel.open}>
          Open Jarvis
        </Button>
      </section>

      <section className="py-5">
        <div className="flex items-center gap-2">
          <IconHeartHandshake className="size-5 text-emerald-700" />
          <h2 className="text-lg font-semibold">CHERISH feedback</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Share a team shoutout, a project win, or a private concern. Offline
          responses remain scoped to your Compass account on this device.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                if (
                  value === "shoutout" ||
                  value === "win" ||
                  value === "concern"
                ) {
                  setResponseType(value)
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESPONSE_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <label className="mb-1.5 mt-3 block text-sm font-medium">
          Message
        </label>
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            responseType === "concern"
              ? "What should leadership know?"
              : "What happened, and who helped?"
          }
          className="min-h-28 resize-y"
          maxLength={1_200}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p
            className={cn(
              "text-sm",
              feedback?.startsWith("Unable") ||
                feedback?.startsWith("Add") ||
                feedback?.startsWith("Keep")
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {feedback ??
              (responseType === "concern"
                ? "Private concerns are visible only to leadership reviewers."
                : "Team responses are visible after review.")}
          </p>
          <Button
            type="button"
            onClick={submitResponse}
            disabled={isPending || message.trim().length < 3}
          >
            {isPending ? "Saving..." : online ? "Submit" : "Save for sync"}
          </Button>
        </div>
      </section>

      <footer className="border-t pt-4 text-sm leading-6 text-muted-foreground">
        Secure photo, video, and document handoff to Jarvis is planned as the
        next field phase. The existing project-photo queue is intentionally not
        reused until Compass can preserve attachment ownership, project scope,
        and an explicit conversion target such as a daily log, to-do, RFI, or
        delivery notification.
      </footer>
    </div>
  )
}
