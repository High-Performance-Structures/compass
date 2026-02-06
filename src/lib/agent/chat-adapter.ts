"use client"

export { useChat } from "@ai-sdk/react"

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
  getRouter: () => { push: (path: string) => void }
): void {
  registerActionHandler("NAVIGATE_TO", (payload) => {
    if (payload?.path && typeof payload.path === "string") {
      getRouter().push(payload.path)
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
}

export const ALL_HANDLER_TYPES = [
  "NAVIGATE_TO",
  "SHOW_TOAST",
  "OPEN_MODAL",
  "CLOSE_MODAL",
  "SCROLL_TO",
  "FOCUS_ELEMENT",
] as const

/**
 * Interpret tool result parts from AI SDK messages
 * as client-side actions and dispatch them.
 */
export function dispatchToolActions(
  parts: ReadonlyArray<{
    type: string
    toolInvocation?: {
      toolName: string
      state: string
      result?: unknown
    }
  }>
): void {
  for (const part of parts) {
    if (
      part.type !== "tool-invocation" ||
      part.toolInvocation?.state !== "result"
    ) {
      continue
    }

    const result = part.toolInvocation.result as
      | Record<string, unknown>
      | undefined

    if (!result?.action) continue

    switch (result.action) {
      case "navigate":
        executeAction({
          type: "NAVIGATE_TO",
          payload: { path: result.path },
        })
        break
      case "toast":
        executeAction({
          type: "SHOW_TOAST",
          payload: {
            message: result.message,
            type: result.type,
          },
        })
        break
    }
  }
}
