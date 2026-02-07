"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  useChatPanel,
  useChatState,
  useRenderState,
} from "./chat-provider"
import { ChatView } from "./chat-view"
import { isNative } from "@/lib/native/platform"

export function ChatPanelShell() {
  const { isOpen, open, close, toggle } = useChatPanel()
  const chat = useChatState()
  const { spec: renderSpec, isRendering } =
    useRenderState()
  const pathname = usePathname()
  const hasRenderedUI = !!renderSpec?.root || isRendering
  // dashboard acts as "page" variant only when NOT rendering
  const isDashboard =
    pathname === "/dashboard" && !hasRenderedUI

  // auto-open panel when leaving dashboard with messages
  const prevIsDashboard = useRef(isDashboard)
  useEffect(() => {
    if (
      prevIsDashboard.current &&
      !isDashboard &&
      chat.messages.length > 0
    ) {
      open()
    }
    prevIsDashboard.current = isDashboard
  }, [isDashboard, chat.messages.length, open])

  // resize state (panel mode only)
  const [panelWidth, setPanelWidth] = useState(480)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartWidth.current) return
      const delta = dragStartX.current - e.clientX
      const next = Math.min(
        720,
        Math.max(320, dragStartWidth.current + delta)
      )
      setPanelWidth(next)
    }
    const onMouseUp = () => {
      if (!dragStartWidth.current) return
      dragStartWidth.current = 0
      setIsResizing(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsResizing(true)
      dragStartX.current = e.clientX
      dragStartWidth.current = panelWidth
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
    },
    [panelWidth]
  )

  // keyboard shortcuts (panel mode only)
  useEffect(() => {
    if (isDashboard) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault()
        toggle()
      }
      if (e.key === "Escape" && isOpen) {
        close()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () =>
      window.removeEventListener("keydown", handleKeyDown)
  }, [isDashboard, isOpen, close, toggle])

  // native keyboard offset for chat input
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  useEffect(() => {
    if (!isNative()) return

    let cleanup: (() => void) | undefined

    async function setupKeyboard() {
      const { Keyboard } = await import(
        "@capacitor/keyboard"
      )
      const showListener = await Keyboard.addListener(
        "keyboardWillShow",
        (info) => setKeyboardHeight(info.keyboardHeight),
      )
      const hideListener = await Keyboard.addListener(
        "keyboardWillHide",
        () => setKeyboardHeight(0),
      )
      cleanup = () => {
        showListener.remove()
        hideListener.remove()
      }
    }

    setupKeyboard()
    return () => cleanup?.()
  }, [])

  // container width/style for panel mode
  const panelStyle =
    !isDashboard && isOpen
      ? { width: panelWidth }
      : undefined

  const keyboardStyle =
    keyboardHeight > 0
      ? { paddingBottom: keyboardHeight }
      : undefined

  return (
    <>
      <div
        className={cn(
          "flex flex-col",
          "transition-[flex,width,border-color,box-shadow,opacity,transform] duration-300 ease-in-out",
          isDashboard
            ? "flex-1 bg-background"
            : [
                "bg-background dark:bg-[oklch(0.255_0_0)]",
                "fixed inset-0 z-50",
                "md:relative md:inset-auto md:z-auto",
                "md:shrink-0 md:overflow-hidden",
                "md:rounded-xl md:border md:border-border md:shadow-lg md:my-2 md:mr-2",
                isResizing && "transition-none",
                isOpen
                  ? "translate-x-0 md:opacity-100"
                  : "translate-x-full md:translate-x-0 md:w-0 md:border-transparent md:shadow-none md:opacity-0",
              ]
        )}
        style={{ ...panelStyle, ...keyboardStyle }}
      >
        {/* Desktop resize handle (panel mode only) */}
        {!isDashboard && (
          <div
            className="absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize md:block hover:bg-border/60 active:bg-border"
            onMouseDown={handleResizeStart}
          />
        )}

        <ChatView
          variant={isDashboard ? "page" : "panel"}
        />
      </div>

      {/* Mobile backdrop (panel mode only) */}
      {!isDashboard && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Mobile FAB (panel mode only) */}
      {!isDashboard && !isOpen && (
        <Button
          size="icon"
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg md:hidden"
          onClick={toggle}
          aria-label="Open chat"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      )}
    </>
  )
}
