"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { usePathname } from "next/navigation"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useChatPanel } from "./chat-provider"

interface ChatPanelShellProps {
  readonly children: React.ReactNode
}

export function ChatPanelShell({
  children,
}: ChatPanelShellProps) {
  const { isOpen, close, toggle } = useChatPanel()
  const setIsOpen = (open: boolean) =>
    open ? undefined : close()
  const pathname = usePathname()

  // resize state
  const [panelWidth, setPanelWidth] = useState(420)
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

  // keyboard shortcuts
  useEffect(() => {
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
  }, [isOpen, close, toggle])

  // dashboard has inline chat, hide shell
  if (pathname === "/dashboard") return null

  return (
    <>
      <div
        className={cn(
          "flex flex-col bg-background",
          "fixed inset-0 z-50",
          "md:relative md:inset-auto md:z-auto",
          "md:shrink-0 md:overflow-hidden md:border-l md:border-border",
          isResizing
            ? "transition-none"
            : "transition-[transform,width,border-color] duration-300 ease-in-out",
          isOpen
            ? "translate-x-0"
            : "translate-x-full md:translate-x-0 md:w-0 md:border-l-0"
        )}
        style={isOpen ? { width: panelWidth } : undefined}
      >
        {/* Desktop resize handle */}
        <div
          className="absolute left-0 top-0 z-10 hidden h-full w-1 cursor-col-resize md:block hover:bg-border/60 active:bg-border"
          onMouseDown={handleResizeStart}
        />

        {children}
      </div>

      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile FAB trigger */}
      {!isOpen && (
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
