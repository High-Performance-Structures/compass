"use client"

type ActionHandler = (
  params: Record<string, unknown> | undefined
) => Promise<void>

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
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: {
            message,
            type: "default",
          },
        })
      )
    }
  },

  formSubmit: async (params) => {
    const formName =
      (params?.formName as string) ?? "Form"
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: {
            message: `${formName} submitted`,
            type: "success",
          },
        })
      )
    }
  },

  exportData: async (params) => {
    const format =
      (params?.format as string) ?? "CSV"
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: {
            message: `Exporting as ${format}...`,
            type: "default",
          },
        })
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
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: {
            message: `Action: ${actionName}`,
            type: "default",
          },
        })
      )
    }
  }
}
