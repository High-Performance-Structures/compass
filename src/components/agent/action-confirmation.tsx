"use client"

import { useState } from "react"
import { IconCheck, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { confirmAgentAction } from "@/app/actions/agent-confirmation"
import type { AgentPart } from "@/lib/agent/message-types"

export interface PendingConfirmation {
  readonly toolCallId: string
  readonly summary: string
  readonly confirmationToken: string
}

/** Tool results where Jarvis is waiting for the user to confirm a change. */
export function pendingConfirmations(
  parts: readonly AgentPart[],
): readonly PendingConfirmation[] {
  const found: PendingConfirmation[] = []
  for (const part of parts) {
    if (part.type !== "tool-result") continue
    const result = part.result
    if (typeof result !== "object" || result === null) continue
    if (!("action" in result) || result.action !== "confirm") continue
    if (!("confirmationToken" in result) || typeof result.confirmationToken !== "string") continue
    const summary =
      "summary" in result && typeof result.summary === "string"
        ? result.summary
        : "Make a change in Compass."
    found.push({
      toolCallId: part.toolCallId,
      summary,
      confirmationToken: result.confirmationToken,
    })
  }
  return found
}

type ConfirmationState =
  | { readonly kind: "pending" }
  | { readonly kind: "working" }
  | { readonly kind: "done" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly error: string }

export function ActionConfirmation({
  summary,
  confirmationToken,
}: {
  readonly summary: string
  readonly confirmationToken: string
}): React.ReactElement {
  const [state, setState] = useState<ConfirmationState>({ kind: "pending" })

  async function confirm(): Promise<void> {
    setState({ kind: "working" })
    const result = await confirmAgentAction(confirmationToken).catch(
      (): { success: false; error: string } => ({
        success: false,
        error: "That change failed.",
      }),
    )
    setState(result.success ? { kind: "done" } : { kind: "failed", error: result.error })
  }

  return (
    <div className="my-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p className="text-foreground">{summary}</p>
      {state.kind === "pending" || state.kind === "working" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={confirm} disabled={state.kind === "working"}>
            <IconCheck className="size-4" />
            {state.kind === "working" ? "Working…" : "Confirm"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setState({ kind: "cancelled" })}
            disabled={state.kind === "working"}
          >
            <IconX className="size-4" />
            Cancel
          </Button>
        </div>
      ) : (
        <p
          className={
            state.kind === "failed"
              ? "mt-2 text-destructive"
              : "mt-2 text-muted-foreground"
          }
        >
          {state.kind === "done"
            ? "Done."
            : state.kind === "cancelled"
              ? "Cancelled. Nothing was changed."
              : state.error}
        </p>
      )}
    </div>
  )
}
