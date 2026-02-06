"use client"

// --- Shared utilities ---

export function getTextFromParts(
  parts: ReadonlyArray<{ type: string; text?: string }>
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text"
    )
    .map((p) => p.text)
    .join("")
}

// --- Action handler registry ---

export interface AgentAction {
  readonly type: string
  readonly payload?: Record<string, unknown>
}

export type ActionHandler = (
  payload?: Record<string, unknown>
) => void | Promise<void>

const actionHandlers = new Map<string, ActionHandler>()

export function registerActionHandler(
  type: string,
  handler: ActionHandler
): void {
  actionHandlers.set(type, handler)
}

export function unregisterActionHandler(
  type: string
): void {
  actionHandlers.delete(type)
}

export async function executeAction(
  action: AgentAction
): Promise<void> {
  const handler = actionHandlers.get(action.type)
  if (handler) {
    await handler(action.payload)
  } else {
    console.warn(
      `No handler registered for action type: ${action.type}`
    )
  }
}

export function initializeActionHandlers(
  getRouter: () => { push: (path: string) => void },
  openPanel?: () => void
): void {
  registerActionHandler("NAVIGATE_TO", (payload) => {
    if (payload?.path && typeof payload.path === "string") {
      const navigate = () => {
        getRouter().push(payload.path as string)
        openPanel?.()
      }

      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => void
      }

      if (doc.startViewTransition) {
        doc.startViewTransition(navigate)
      } else {
        navigate()
      }
    }
  })

  registerActionHandler("SHOW_TOAST", (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-toast", { detail: payload })
      )
    }
  })

  registerActionHandler("OPEN_MODAL", (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-modal", { detail: payload })
      )
    }
  })

  registerActionHandler("CLOSE_MODAL", () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-modal-close")
      )
    }
  })

  registerActionHandler("SCROLL_TO", (payload) => {
    if (
      payload?.target &&
      typeof payload.target === "string"
    ) {
      const el = document.querySelector(
        `[data-section="${payload.target}"], #${payload.target}`
      )
      el?.scrollIntoView({ behavior: "smooth" })
    }
  })

  registerActionHandler("FOCUS_ELEMENT", (payload) => {
    if (
      payload?.selector &&
      typeof payload.selector === "string"
    ) {
      const el = document.querySelector(
        payload.selector
      ) as HTMLElement | null
      el?.focus()
    }
  })

  registerActionHandler("GENERATE_UI", (payload) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-generate-ui", {
          detail: payload,
        })
      )
    }
  })
}

export const ALL_HANDLER_TYPES = [
  "NAVIGATE_TO",
  "SHOW_TOAST",
  "OPEN_MODAL",
  "CLOSE_MODAL",
  "SCROLL_TO",
  "FOCUS_ELEMENT",
  "GENERATE_UI",
] as const

/**
 * Interpret tool result parts from AI SDK messages
 * as client-side actions and dispatch them.
 * Pass a `dispatched` set to avoid re-firing on re-renders.
 *
 * AI SDK v6 part formats:
 *   Static:  type "tool-<name>", state/output flat
 *   Dynamic: type "dynamic-tool", toolName field, same
 */
export function dispatchToolActions(
  parts: ReadonlyArray<Record<string, unknown>>,
  dispatched?: Set<string>
): void {
  for (const part of parts) {
    const pType = part.type as string | undefined
    const isToolPart =
      typeof pType === "string" &&
      (pType.startsWith("tool-") ||
        pType === "dynamic-tool")
    if (!isToolPart) continue

    const state = part.state as string | undefined
    if (state !== "output-available") continue

    const callId = part.toolCallId as string | undefined
    if (callId && dispatched?.has(callId)) continue

    const output = part.output as
      | Record<string, unknown>
      | undefined

    if (!output?.action) continue

    if (callId) dispatched?.add(callId)

    switch (output.action) {
      case "navigate":
        executeAction({
          type: "NAVIGATE_TO",
          payload: { path: output.path },
        })
        break
      case "toast":
        executeAction({
          type: "SHOW_TOAST",
          payload: {
            message: output.message,
            type: output.type,
          },
        })
        break
      case "generateUI":
        executeAction({
          type: "GENERATE_UI",
          payload: {
            renderPrompt: output.renderPrompt,
            dataContext: output.dataContext,
          },
        })
        break
    }
  }
}
