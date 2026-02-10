"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
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
  const isMobile = useIsMobile()
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
    // If dashboard, we ignore shortcut because the shell itself is hidden!
    // But we are rendering because we are before the return null.
    // So we should check if isDashboard here for safety?
    // Actually, if isDashboard is true, the shell component might still mount/unmount?
    // The conditional return is below. So this effect RUNS.
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

  // keyboard style
  const keyboardStyle = keyboardHeight > 0
    ? { paddingBottom: keyboardHeight }
    : {}

  // container width/style for panel mode - only apply on desktop
  const computedStyle = {
    ...keyboardStyle,
    // Only apply panel width on desktop (not mobile)
    ...((!isDashboard && isOpen && !isMobile) ? { width: panelWidth } : {}),
  }

  // Compass rotation animation
  const [compassRotation, setCompassRotation] = useState(0)
  useEffect(() => {
    // Initial random rotation
    setCompassRotation(Math.floor(Math.random() * 360))

    const updateRotation = () => {
      const newRotation = Math.floor(Math.random() * 360)
      setCompassRotation(newRotation)
    }

    const interval = setInterval(() => {
      updateRotation()
    }, 1000 + Math.random() * 1500)

    return () => clearInterval(interval)
  }, [])

  if (isDashboard) return null

  return (
    <>
      <div
        className={cn(
          "flex flex-col",
          "transition-[flex,width,border-color,box-shadow,opacity,transform] duration-300 ease-in-out",
          isDashboard
            ? "flex-1 bg-background"
            : [
              "bg-background",
              "fixed z-50",
              "inset-0 md:inset-0",
              "top-14 bottom-14 md:top-auto md:bottom-auto",
              "md:relative md:inset-auto md:z-auto",
              "md:shrink-0 md:overflow-hidden",
              "md:rounded-xl md:border md:border-border md:shadow-lg md:my-2 md:mr-2",
              isResizing && "transition-none",
              isOpen
                ? "translate-x-0 md:opacity-100"
                : "translate-x-full md:translate-x-0 md:w-0 md:border-transparent md:shadow-none md:opacity-0 pointer-events-none",
            ]
        )}
        style={computedStyle}
      >
        {/* Mobile header */}
        {!isDashboard && (
          <div className="flex items-center justify-center bg-background px-4 py-3 md:hidden">
            <span className="text-base font-semibold text-foreground">Compass</span>
          </div>
        )}

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

      {/* Open chat button - shows when chat is closed */}
      {!isDashboard && !isOpen && (
        <button
          onClick={toggle}
          className={cn(
            "fixed z-50 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-200 hover:scale-105 active:scale-95",
            "bottom-20 right-4 md:bottom-8 md:right-8",
            "h-14 w-14 md:h-auto md:w-auto md:px-4 md:py-3"
          )}
          aria-label="Open chat"
        >
          <span
            className="block bg-primary-foreground md:mr-2"
            style={{
              maskImage: "url(/logo-black.png)",
              maskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskImage: "url(/logo-black.png)",
              WebkitMaskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              width: "1.75rem",
              height: "1.75rem",
              transform: `rotate(${compassRotation}deg)`,
              transition: "transform 1.2s ease-in-out",
              willChange: "transform",
            }}
          />
          <span className="hidden md:inline text-sm font-medium">Chat with Compass</span>
        </button>
      )}
    </>
  )
}
