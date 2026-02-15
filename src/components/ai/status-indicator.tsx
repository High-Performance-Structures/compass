"use client"

import {
  BrainIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { cn } from "@/lib/utils"

export type StatusState = "streaming" | "complete" | "error" | "pending"

export interface StatusIndicatorProps {
  state: StatusState
  icon?: ReactNode
  label: ReactNode
  chevronDirection?: "up" | "down" | "none"
  className?: string
}

const getStatusIcon = (state: StatusState, customIcon?: ReactNode): ReactNode => {
  if (customIcon) return customIcon

  switch (state) {
    case "streaming":
    case "pending":
      return <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
    case "complete":
      return <CheckCircleIcon className="size-3.5 text-primary" />
    case "error":
      return <XCircleIcon className="size-3.5 text-destructive" />
    default:
      return <LoaderIcon className="size-3.5 text-muted-foreground" />
  }
}

export function StatusIndicator({
  state,
  icon,
  label,
  chevronDirection = "down",
  className,
}: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors",
        "hover:bg-muted/80",
        className,
      )}
    >
      {getStatusIcon(state, icon)}
      <span>{label}</span>
      {chevronDirection !== "none" && (
        <ChevronDownIcon
          className={cn(
            "size-3 opacity-50 transition-transform",
            chevronDirection === "up" && "rotate-180",
          )}
        />
      )}
    </span>
  )
}

export interface ThinkingIndicatorProps {
  isStreaming: boolean
  duration?: number
  className?: string
}

export function ThinkingIndicator({
  isStreaming,
  duration,
  className,
}: ThinkingIndicatorProps) {
  const label = isStreaming
    ? "Thinking..."
    : duration === undefined
      ? "Thought for a few seconds"
      : `Thought for ${duration} seconds`

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors",
        "hover:bg-muted/80",
        className,
      )}
    >
      {isStreaming ? (
        <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
      ) : (
        <BrainIcon className="size-3.5" />
      )}
      <span>{label}</span>
      <ChevronDownIcon className="size-3 opacity-50" />
    </span>
  )
}

export interface CollapsibleIndicatorProps extends ComponentProps<"button"> {
  isStreaming?: boolean
  isOpen?: boolean
  icon?: ReactNode
  label: ReactNode
  variant?: "thinking" | "tool" | "default"
}

export function CollapsibleIndicator({
  isStreaming = false,
  isOpen = false,
  icon,
  label,
  variant = "default",
  className,
  ...props
}: CollapsibleIndicatorProps) {
  const displayIcon = isStreaming ? (
    <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
  ) : (
    icon
  )

  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors",
        "hover:bg-muted/80",
        className,
      )}
      {...props}
    >
      {displayIcon}
      <span>{label}</span>
      <ChevronDownIcon
        className={cn(
          "size-3 opacity-50 transition-transform",
          isOpen && "rotate-180",
        )}
      />
    </button>
  )
}

/** Demo component for preview */
export default function StatusIndicatorDemo() {
  return (
    <div className="flex flex-col items-start gap-4 p-8">
      <h3 className="font-semibold text-sm">Status Indicators</h3>
      <div className="flex flex-wrap gap-2">
        <StatusIndicator state="streaming" label="Processing..." chevronDirection="none" />
        <StatusIndicator state="complete" label="Complete" chevronDirection="none" />
        <StatusIndicator state="error" label="Failed" chevronDirection="none" />
        <StatusIndicator state="pending" label="Queued" chevronDirection="none" />
      </div>

      <h3 className="mt-4 font-semibold text-sm">Thinking Indicators</h3>
      <div className="flex flex-wrap gap-2">
        <ThinkingIndicator isStreaming={true} />
        <ThinkingIndicator isStreaming={false} duration={5} />
        <ThinkingIndicator isStreaming={false} />
      </div>

      <h3 className="mt-4 font-semibold text-sm">With Icons</h3>
      <div className="flex flex-wrap gap-2">
        <StatusIndicator
          state="complete"
          icon={<BrainIcon className="size-3.5" />}
          label="Analyzed"
          chevronDirection="down"
        />
      </div>
    </div>
  )
}
