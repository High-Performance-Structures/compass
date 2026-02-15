"use client"

import { cn } from "@/lib/utils"

type TypingUser = {
  id: string
  displayName: string | null
}

type TypingIndicatorProps = {
  readonly className?: string
  readonly users?: readonly TypingUser[]
}

function formatTypingText(users: readonly TypingUser[]): string {
  const names = users.map((u) => u.displayName ?? "Someone")

  if (names.length === 0) {
    return "Someone is typing"
  } else if (names.length === 1) {
    return `${names[0]} is typing`
  } else if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing`
  } else if (names.length === 3) {
    return `${names[0]}, ${names[1]}, and ${names[2]} are typing`
  } else {
    return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing`
  }
}

export function TypingIndicator({ className, users }: TypingIndicatorProps) {
  const text = formatTypingText(users ?? [])

  return (
    <div className={cn("flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground", className)}>
      <span>{text}</span>
      <div className="flex gap-0.5">
        <span className="animate-[pulse_1s_ease-in-out_infinite] text-base [animation-delay:-0.3s]">.</span>
        <span className="animate-[pulse_1s_ease-in-out_infinite] text-base [animation-delay:-0.15s]">.</span>
        <span className="animate-[pulse_1s_ease-in-out_infinite] text-base">.</span>
      </div>
    </div>
  )
}
