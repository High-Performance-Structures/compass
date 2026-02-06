"use client"

type ActionHandler = (
  params: Record<string, unknown> | undefined
) => Promise<void>

function toast(
  message: string,
  type: "default" | "success" | "error" = "default",
): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent("agent-toast", {
      detail: { message, type },
    })
  )
}

async function callActionBridge(
  action: string,
  params: Record<string, unknown>,
): Promise<{
  success: boolean
  data?: unknown
  error?: string
}> {
  const res = await fetch("/api/agent/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  })
  return res.json()
}

const actionHandlers: Record<string, ActionHandler> = {
  navigateTo: async (params) => {
    const path = params?.path as string | undefined
    if (path && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-render-navigate", {
          detail: { path },
        })
      )
    }
  },

  viewRecord: async (params) => {
    const type = params?.type as string | undefined
    const id = params?.id as string | undefined
    if (type && id && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-render-navigate", {
          detail: {
            path: `/dashboard/${type}s/${id}`,
          },
        })
      )
    }
  },

  buttonClick: async (params) => {
    const message =
      (params?.message as string) ?? "Button clicked!"
    toast(message)
  },

  formSubmit: async (params) => {
    const action = params?.action as string | undefined
    const formData = params?.formData as
      | Record<string, unknown>
      | undefined
    const actionParams = params?.actionParams as
      | Record<string, unknown>
      | undefined

    if (!action) {
      const formName =
        (params?.formName as string) ?? "Form"
      toast(`${formName} submitted`, "success")
      return
    }

    const mergedParams = {
      ...actionParams,
      ...formData,
    }

    const result = await callActionBridge(
      action,
      mergedParams,
    )
    if (result.success) {
      toast("Saved successfully", "success")
    } else {
      toast(result.error ?? "Something went wrong", "error")
    }
  },

  exportData: async (params) => {
    const format =
      (params?.format as string) ?? "CSV"
    toast(`Exporting as ${format}...`)
  },

  mutate: async (params) => {
    const action = params?.action as string | undefined
    const actionParams = (params?.params ??
      {}) as Record<string, unknown>

    if (!action) {
      toast("Missing action name", "error")
      return
    }

    const result = await callActionBridge(
      action,
      actionParams,
    )
    if (result.success) {
      toast("Done", "success")
    } else {
      toast(result.error ?? "Something went wrong", "error")
    }
  },

  confirmDelete: async (params) => {
    const action = params?.action as string | undefined
    const id = params?.id as string | undefined
    const label =
      (params?.label as string) ?? "this item"

    if (!action || !id) {
      toast("Missing delete parameters", "error")
      return
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ${label}?`
    )
    if (!confirmed) return

    const result = await callActionBridge(action, { id })
    if (result.success) {
      toast("Deleted", "success")
    } else {
      toast(
        result.error ?? "Failed to delete",
        "error",
      )
    }
  },
}

export async function executeAction(
  actionName: string,
  params?: Record<string, unknown>
): Promise<void> {
  const handler = actionHandlers[actionName]
  if (handler) {
    await handler(params)
  } else {
    toast(`Action: ${actionName}`)
  }
}

export { actionHandlers }
