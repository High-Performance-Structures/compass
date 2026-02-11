"use client"

import * as React from "react"
import { type UIMessage } from "ai"
import { useUIStream, type Spec } from "@json-render/react"
import { usePathname, useRouter } from "next/navigation"
import {
  saveConversation,
  loadConversation,
  loadConversations,
} from "@/app/actions/agent"
import { getTextFromParts } from "@/lib/agent/chat-adapter"
import { useCompassChat } from "@/hooks/use-compass-chat"
import {
  WebSocketChatTransport,
  detectBridge,
} from "@/lib/agent/ws-transport"
import {
  getBridgeSnapshot,
  subscribeBridge,
  setBridgeConnected as storeBridgeConnected,
  setBridgeEnabled as storeBridgeEnabled,
} from "@/lib/agent/bridge-store"

// --- Panel context (open/close sidebar) ---

interface PanelContextValue {
  readonly isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const PanelContext =
  React.createContext<PanelContextValue | null>(null)

export function useChatPanel(): PanelContextValue {
  const ctx = React.useContext(PanelContext)
  if (!ctx) {
    throw new Error(
      "useChatPanel must be used within a ChatProvider"
    )
  }
  return ctx
}

// --- Chat state context ---

interface ChatStateValue {
  readonly messages: ReadonlyArray<UIMessage>
  setMessages: (
    messages:
      | UIMessage[]
      | ((prev: UIMessage[]) => UIMessage[])
  ) => void
  sendMessage: (params: { text: string }) => void
  regenerate: () => void
  stop: () => void
  readonly status: string
  readonly isGenerating: boolean
  readonly conversationId: string
  newChat: () => void
  readonly pathname: string
}

const ChatStateContext =
  React.createContext<ChatStateValue | null>(null)

export function useChatState(): ChatStateValue {
  const ctx = React.useContext(ChatStateContext)
  if (!ctx) {
    throw new Error(
      "useChatState must be used within a ChatProvider"
    )
  }
  return ctx
}

export function useChatStateOptional(): ChatStateValue | null {
  return React.useContext(ChatStateContext)
}

// --- Render state context ---

interface RenderContextValue {
  readonly spec: Spec | null
  readonly isRendering: boolean
  readonly error: Error | null
  readonly dataContext: Record<string, unknown>
  triggerRender: (
    prompt: string,
    data: Record<string, unknown>
  ) => void
  clearRender: () => void
  loadSpec: (
    spec: Spec,
    data: Record<string, unknown>
  ) => void
}

const RenderContext =
  React.createContext<RenderContextValue | null>(null)

export function useRenderState(): RenderContextValue {
  const ctx = React.useContext(RenderContext)
  if (!ctx) {
    throw new Error(
      "useRenderState must be used within a ChatProvider"
    )
  }
  return ctx
}

// --- Bridge state (module-level store, works anywhere) ---

export interface BridgeContextValue {
  readonly bridgeConnected: boolean
  readonly bridgeEnabled: boolean
  setBridgeEnabled: (enabled: boolean) => void
}

export function useBridgeState(): BridgeContextValue {
  const snapshot = React.useSyncExternalStore(
    subscribeBridge,
    getBridgeSnapshot,
    getBridgeSnapshot
  )
  return React.useMemo(
    () => ({
      bridgeConnected: snapshot.connected,
      bridgeEnabled: snapshot.enabled,
      setBridgeEnabled: storeBridgeEnabled,
    }),
    [snapshot]
  )
}

// --- Backward compat aliases ---

export function useAgent(): PanelContextValue {
  return useChatPanel()
}

export function useAgentOptional(): PanelContextValue | null {
  return React.useContext(PanelContext)
}

// --- Helper: extract generateUI output from parts ---

function findGenerateUIOutput(
  parts: ReadonlyArray<unknown>,
  dispatched: Set<string>
): {
  renderPrompt: string
  dataContext: Record<string, unknown>
  callId: string
} | null {
  for (const part of parts) {
    const p = part as Record<string, unknown>
    const pType = p.type as string | undefined

    // handle both static tool parts (tool-<name>)
    // and dynamic tool parts (dynamic-tool)
    const isToolPart =
      typeof pType === "string" &&
      (pType.startsWith("tool-") ||
        pType === "dynamic-tool")
    if (!isToolPart) continue

    const state = p.state as string | undefined
    if (state !== "output-available") continue

    const callId = p.toolCallId as string | undefined
    if (!callId || dispatched.has(callId)) continue

    const output = p.output as
      | Record<string, unknown>
      | undefined
    if (output?.action !== "generateUI") continue

    return {
      renderPrompt: output.renderPrompt as string,
      dataContext:
        (output.dataContext as Record<
          string,
          unknown
        >) ?? {},
      callId,
    }
  }
  return null
}

// --- Provider component ---

export function ChatProvider({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [conversationId, setConversationId] =
    React.useState("")

  // generate initial ID client-side only to avoid hydration mismatch
  React.useEffect(() => {
    setConversationId((prev) =>
      prev === "" ? crypto.randomUUID() : prev
    )
  }, [])
  const [resumeLoaded, setResumeLoaded] =
    React.useState(false)
  const [dataContext, setDataContext] = React.useState<
    Record<string, unknown>
  >({})
  const [loadedSpec, setLoadedSpec] =
    React.useState<Spec | null>(null)

  const router = useRouter()
  const pathname = usePathname()

  // --- Bridge daemon state (reads from module store) ---
  const bridge = useBridgeState()

  // detect bridge on interval, write to store
  React.useEffect(() => {
    let cancelled = false
    const check = async () => {
      const connected = await detectBridge()
      if (!cancelled) storeBridgeConnected(connected)
    }
    check()
    const interval = setInterval(check, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const bridgeTransport = React.useMemo(() => {
    if (bridge.bridgeConnected && bridge.bridgeEnabled) {
      return new WebSocketChatTransport()
    }
    return null
  }, [bridge.bridgeConnected, bridge.bridgeEnabled])

  const chat = useCompassChat({
    conversationId,
    openPanel: () => setIsOpen(true),
    bridgeTransport,
    onFinish: async ({ messages: finalMessages }) => {
      if (finalMessages.length === 0) return

      const serialized = finalMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: getTextFromParts(
          m.parts as ReadonlyArray<{
            type: string
            text?: string
          }>
        ),
        parts: m.parts,
        createdAt: new Date().toISOString(),
      }))

      await saveConversation(conversationId, serialized)
    },
  })

  // UI stream for json-render — stabilize callbacks
  const onRenderError = React.useCallback(
    (err: Error) => {
      console.error("Render stream error:", err)
    },
    []
  )

  const renderStream = useUIStream({
    api: "/api/agent/render",
    onError: onRenderError,
  })

  // use refs to avoid stale closures and
  // unstable effect deps
  const renderSendRef = React.useRef(renderStream.send)
  renderSendRef.current = renderStream.send

  const renderSpecRef = React.useRef(renderStream.spec)
  renderSpecRef.current = renderStream.spec

  const renderClearRef = React.useRef(renderStream.clear)
  renderClearRef.current = renderStream.clear

  const pathnameRef = React.useRef(pathname)
  pathnameRef.current = pathname

  const routerRef = React.useRef(router)
  routerRef.current = router

  const loadedSpecRef = React.useRef(loadedSpec)
  loadedSpecRef.current = loadedSpec

  const triggerRender = React.useCallback(
    (prompt: string, data: Record<string, unknown>) => {
      setDataContext(data)
      setLoadedSpec(null)
      renderSendRef.current(prompt, {
        dataContext: data,
        previousSpec:
          renderSpecRef.current ??
          loadedSpecRef.current ??
          undefined,
      })
    },
    []
  )

  const clearRender = React.useCallback(() => {
    renderClearRef.current()
    setDataContext({})
    setLoadedSpec(null)
  }, [])

  const loadSpec = React.useCallback(
    (spec: Spec, data: Record<string, unknown>) => {
      renderClearRef.current()
      setLoadedSpec(spec)
      setDataContext(data)
    },
    [],
  )

  // watch chat messages for generateUI tool results
  // and trigger render stream directly (no event chain)
  const renderDispatchedRef = React.useRef(
    new Set<string>()
  )

  React.useEffect(() => {
    const lastMsg = chat.messages.at(-1)
    if (!lastMsg || lastMsg.role !== "assistant") return

    const result = findGenerateUIOutput(
      lastMsg.parts as ReadonlyArray<unknown>,
      renderDispatchedRef.current
    )
    if (!result) return

    renderDispatchedRef.current.add(result.callId)

    // navigate to /dashboard if not there
    if (pathnameRef.current !== "/dashboard") {
      routerRef.current.push("/dashboard")
    }

    // open chat panel for sidebar mode
    setIsOpen(true)

    // trigger the render stream
    triggerRender(result.renderPrompt, result.dataContext)
  }, [chat.messages, triggerRender])

  // listen for save-dashboard events from tool dispatch
  React.useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        name?: string
        description?: string
        dashboardId?: string
      }
      if (!detail?.name) return

      const currentSpec =
        renderSpecRef.current ?? loadedSpecRef.current
      if (!currentSpec) return

      const { saveCustomDashboard } = await import(
        "@/app/actions/dashboards"
      )

      const result = await saveCustomDashboard(
        detail.name,
        detail.description ?? "",
        JSON.stringify(currentSpec),
        JSON.stringify([]),
        detail.name,
        detail.dashboardId,
      )

      if (result.success) {
        window.dispatchEvent(
          new CustomEvent("agent-toast", {
            detail: {
              message: `Dashboard "${detail.name}" saved`,
              type: "success",
            },
          })
        )
      } else {
        window.dispatchEvent(
          new CustomEvent("agent-toast", {
            detail: {
              message: result.error,
              type: "error",
            },
          })
        )
      }
    }

    window.addEventListener(
      "agent-save-dashboard",
      handler
    )
    return () =>
      window.removeEventListener(
        "agent-save-dashboard",
        handler
      )
  }, [])

  // listen for load-dashboard events from tool dispatch
  React.useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        dashboardId?: string
        spec?: Spec
        queries?: string
        renderPrompt?: string
        editPrompt?: string
      }
      if (!detail?.spec) return

      // run saved queries for fresh data
      let freshData: Record<string, unknown> = {}
      if (detail.queries) {
        const { executeDashboardQueries } = await import(
          "@/app/actions/dashboards"
        )
        const result = await executeDashboardQueries(
          detail.queries,
        )
        if (result.success) {
          freshData = result.data
        }
      }

      loadSpec(detail.spec, freshData)

      // navigate to /dashboard
      if (pathnameRef.current !== "/dashboard") {
        routerRef.current.push("/dashboard")
      }
      setIsOpen(true)

      // if editPrompt provided, trigger re-render
      if (detail.editPrompt) {
        setTimeout(() => {
          triggerRender(detail.editPrompt!, freshData)
        }, 100)
      }
    }

    window.addEventListener(
      "agent-load-dashboard",
      handler
    )
    return () =>
      window.removeEventListener(
        "agent-load-dashboard",
        handler
      )
  }, [loadSpec, triggerRender])

  // listen for navigation events from rendered UI
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        path?: string
      }
      if (detail?.path) {
        routerRef.current.push(detail.path)
      }
    }

    window.addEventListener(
      "agent-render-navigate",
      handler
    )
    return () =>
      window.removeEventListener(
        "agent-render-navigate",
        handler
      )
  }, [])

  // resume last conversation on first open
  React.useEffect(() => {
    if (!isOpen || resumeLoaded) return

    const resume = async () => {
      const result = await loadConversations()
      if (
        !result.success ||
        !result.data ||
        result.data.length === 0
      ) {
        setResumeLoaded(true)
        return
      }

      const lastConv = result.data[0]
      const msgResult = await loadConversation(lastConv.id)
      if (
        !msgResult.success ||
        !msgResult.data ||
        msgResult.data.length === 0
      ) {
        setResumeLoaded(true)
        return
      }

      setConversationId(lastConv.id)

      const restored: UIMessage[] = msgResult.data.map(
        (m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          parts:
            (m.parts as UIMessage["parts"]) ?? [
              { type: "text" as const, text: m.content },
            ],
        })
      )
      chat.setMessages(restored)
      setResumeLoaded(true)
    }

    resume()
  }, [isOpen, resumeLoaded, chat.setMessages])

  const newChat = React.useCallback(() => {
    chat.setMessages([])
    setConversationId(crypto.randomUUID())
    setResumeLoaded(true)
    clearRender()
    setLoadedSpec(null)
    renderDispatchedRef.current.clear()
  }, [chat.setMessages, clearRender])

  const panelValue = React.useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
    }),
    [isOpen]
  )

  const chatValue = React.useMemo(
    () => ({
      messages: chat.messages,
      setMessages: chat.setMessages,
      sendMessage: chat.sendMessage,
      regenerate: chat.regenerate,
      stop: chat.stop,
      status: chat.status,
      isGenerating: chat.isGenerating,
      conversationId,
      newChat,
      pathname: chat.pathname,
    }),
    [
      chat.messages,
      chat.setMessages,
      chat.sendMessage,
      chat.regenerate,
      chat.stop,
      chat.status,
      chat.isGenerating,
      conversationId,
      newChat,
      chat.pathname,
    ]
  )

  const renderValue = React.useMemo(
    () => ({
      spec: renderStream.spec ?? loadedSpec,
      isRendering: renderStream.isStreaming,
      error: renderStream.error,
      dataContext,
      triggerRender,
      clearRender,
      loadSpec,
    }),
    [
      renderStream.spec,
      loadedSpec,
      renderStream.isStreaming,
      renderStream.error,
      dataContext,
      triggerRender,
      clearRender,
      loadSpec,
    ]
  )

  return (
    <PanelContext.Provider value={panelValue}>
      <ChatStateContext.Provider value={chatValue}>
        <RenderContext.Provider value={renderValue}>
          {children}
        </RenderContext.Provider>
      </ChatStateContext.Provider>
    </PanelContext.Provider>
  )
}
