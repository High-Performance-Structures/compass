"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import { XIcon, ChevronLeft } from "lucide-react"
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
      ? ({ "--panel-width": `${panelWidth}px` } as React.CSSProperties)
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
            ? "flex-1 bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
            : [
              "bg-background dark:bg-[oklch(0.255_0_0)]",
              "fixed inset-0 z-[60]",
              "pb-[env(safe-area-inset-bottom)]",
              "w-full md:w-[var(--panel-width)]", // Use CSS var for responsive width
              "md:relative md:inset-auto md:z-auto md:pb-0",
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
        {/* Header with Back/Close Button */}
        {!isDashboard && isOpen && (
          <div className="flex items-center p-2 border-b shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Button variant="ghost" size="sm" onClick={close} className="gap-1 text-muted-foreground hover:text-foreground">
              {/* Mobile Back */}
              <span className="flex items-center gap-1 md:hidden">
                <ChevronLeft className="h-4 w-4" />
                Back
              </span>
              {/* Desktop Close */}
              <span className="hidden md:flex items-center gap-1">
                <XIcon className="h-4 w-4" />
                Close
              </span>
            </Button>
          </div>
        )}

        {/* Desktop resize handle (panel mode only) */}
        {!isDashboard && (
          <div
            className="absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize md:block hover:bg-border/60 active:bg-border"
            onMouseDown={handleResizeStart}
          />
        )}

        {isDashboard ? (
          <ChatView variant="page" />
        ) : (
          <div className="flex-1 min-h-0 relative">
            <ChatView variant="panel" />
          </div>
        )}
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
      {/* Chat Toggle FAB (visible on specific pages) */}
      {!isDashboard && (
        <Button
          className={cn(
            "fixed right-4 z-50 h-12 rounded-full shadow-lg transition-transform",
            "w-12 p-0 md:w-auto md:px-4", // Adaptive width/shape
            "bottom-[4.5rem] md:bottom-4", // Positioning
            isOpen && "hidden" // Hide when open
          )}
          onClick={toggle}
          aria-label={isOpen ? "Close chat" : "Open chat"}
        >
          {isOpen ? (
            <XIcon className="h-5 w-5" />
          ) : (
            <>
              <span
                className={cn(
                  "!size-6 block bg-current",
                  !isOpen && "animate-[spin_5s_ease-in-out_infinite_alternate]"
                )}
                style={{
                  maskImage: "url(/logo-black.png)",
                  maskSize: "contain",
                  maskRepeat: "no-repeat",
                  WebkitMaskImage: "url(/logo-black.png)",
                  WebkitMaskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                }}
              />
              <span className="hidden md:ml-2 md:block font-semibold">Compass</span>
            </>
          )}
        </Button>
      )}
    </>
  )
}
