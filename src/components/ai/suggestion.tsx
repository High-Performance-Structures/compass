"use client"

import type { ComponentProps } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export type SuggestionsProps = ComponentProps<typeof ScrollArea>

export const Suggestions = ({ className, children, ...props }: SuggestionsProps) => (
  <ScrollArea className="w-full overflow-x-auto whitespace-nowrap" {...props}>
    <div className={cn("flex w-max flex-nowrap items-center gap-2 py-4", className)}>{children}</div>
    <ScrollBar className="hidden" orientation="horizontal" />
  </ScrollArea>
)

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string
  onClick?: (suggestion: string) => void
}

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = () => {
    onClick?.(suggestion)
  }

  return (
    <Button
      className={cn(
        "cursor-pointer rounded-full px-4 border border-border/60 bg-background/80 backdrop-blur-sm hover:bg-muted/50 hover:border-border group transition-all",
        className
      )}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      <span className="inline-block bg-gradient-to-r from-[#0d9488] via-[#059669] to-[#0891b2] dark:from-[#2dd4bf] dark:via-[#34d399] dark:to-[#22d3ee] bg-[length:200%_auto] animate-[spectral_5s_ease_infinite] bg-clip-text text-transparent group-hover:animate-[bounce-wave_0.8s_ease-in-out]">
        {children || suggestion}
      </span>
    </Button>
  )
}

/** Demo component for preview */
export default function SuggestionDemo() {
  const suggestions = [
    "What are the latest trends in AI?",
    "How does machine learning work?",
    "Explain quantum computing",
    "Best practices for React development",
  ]

  return (
    <div className="p-6">
      <Suggestions>
        {suggestions.map(suggestion => (
          <Suggestion
            key={suggestion}
            onClick={s => console.log("Selected:", s)}
            suggestion={suggestion}
          />
        ))}
      </Suggestions>
    </div>
  )
}
