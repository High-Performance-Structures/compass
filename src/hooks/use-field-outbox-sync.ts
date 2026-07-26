"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { submitCherishPulseResponse } from "@/app/actions/cherish-pulse"
import {
  createJarvisPromptOutboxItem,
  enqueueFieldOutboxItem,
  FIELD_OUTBOX_CHANGED_EVENT,
  listFieldOutboxItems,
  removeFieldOutboxItem,
  type FieldOutboxItem,
} from "@/lib/field/offline-outbox"

type SendOnlineMessage = (params: {
  readonly text: string
}) => Promise<boolean>

export function useFieldOutboxSync(input: {
  readonly scopeKey: string | null
  readonly canUseAskJarvis: boolean
  readonly canSubmitCherish: boolean
  readonly chatStatus: string
  readonly sendOnlineMessage: SendOnlineMessage
}): {
  readonly sendMessage: SendOnlineMessage
  readonly pendingCount: number
} {
  const {
    scopeKey,
    canUseAskJarvis,
    canSubmitCherish,
    chatStatus,
    sendOnlineMessage,
  } = input
  const [revision, setRevision] = useState(0)
  const processingRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    setRevision((current) => current + 1)
  }, [])

  useEffect(() => {
    function handleChanged(event: Event): void {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (
        typeof detail === "object" &&
        detail !== null &&
        "scopeKey" in detail &&
        detail.scopeKey === scopeKey
      ) {
        refresh()
      }
    }

    window.addEventListener("online", refresh)
    window.addEventListener(FIELD_OUTBOX_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener("online", refresh)
      window.removeEventListener(FIELD_OUTBOX_CHANGED_EVENT, handleChanged)
    }
  }, [refresh, scopeKey])

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (
      !scopeKey ||
      !navigator.onLine ||
      processingRef.current ||
      chatStatus === "streaming"
    ) {
      return
    }

    const item = listFieldOutboxItems(scopeKey).find((candidate) => {
      if (candidate.kind === "jarvis_prompt") return canUseAskJarvis
      return canSubmitCherish
    })
    if (!item) return

    processingRef.current = true
    let completed = false

    async function processItem(
      pendingItem: FieldOutboxItem,
    ): Promise<void> {
      if (pendingItem.kind === "jarvis_prompt") {
        completed = await sendOnlineMessage({ text: pendingItem.text })
        return
      }

      const result = await submitCherishPulseResponse({
        cherishValue: pendingItem.cherishValue,
        responseType: pendingItem.responseType,
        message: pendingItem.message,
        source: "compass_mobile",
      })
      completed = result.success
    }

    void processItem(item)
      .catch(() => {
        completed = false
      })
      .finally(() => {
        processingRef.current = false
        if (!completed) {
          if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current)
          }
          retryTimerRef.current = setTimeout(refresh, 30_000)
          return
        }

        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current)
          retryTimerRef.current = null
        }
        removeFieldOutboxItem(scopeKey, item.id)
        refresh()
        toast.success(
          item.kind === "jarvis_prompt"
            ? "Pending message sent to Jarvis."
            : "Pending CHERISH response synced.",
        )
      })
  }, [
    canSubmitCherish,
    canUseAskJarvis,
    chatStatus,
    refresh,
    revision,
    scopeKey,
    sendOnlineMessage,
  ])

  const sendMessage = useCallback<SendOnlineMessage>(
    async ({ text }) => {
      const trimmed = text.trim()
      if (!trimmed || !canUseAskJarvis) return false

      if (!scopeKey || navigator.onLine) {
        return sendOnlineMessage({ text: trimmed })
      }

      const queued = enqueueFieldOutboxItem(
        scopeKey,
        createJarvisPromptOutboxItem(trimmed),
      )
      if (!queued) {
        toast.error("Unable to save this message for later.")
        return false
      }

      refresh()
      toast.success(
        "Message saved on this device. Jarvis will receive it when you reconnect.",
      )
      return true
    },
    [canUseAskJarvis, refresh, scopeKey, sendOnlineMessage],
  )

  const pendingCount = scopeKey
    ? listFieldOutboxItems(scopeKey).length
    : 0

  return { sendMessage, pendingCount }
}
